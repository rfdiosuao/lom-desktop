import { agentRow } from '@/state/agentCatalog';
export { agentRow, logoUrl } from '@/state/agentCatalog';
import { api, CoreError } from '@/core/client';
import { conversationOf, paneOf } from '@/features/teams/runtime/team';
import { S, update } from '@/state/store';
import { cachedOptions, choiceName, effortOption, modelOption } from './agentOptions';
import { canPin } from './agentState';
import type { Conv, Team } from '@/state/types';

/* ===== 其他 Agent（Codex CLI、Claude Code、Pi……）：由核心检测本机已安装的 CLI =====
 * 「Lom」是内置的总指挥，始终在切换器第一位；用户在「设置 → Agents」里把其他 Agent 加到切换器。
 * 新建任务时选中的 Agent 决定会话类型；已有任务的 Agent 不变。 */

export type AgentStatus = 'missing' | 'online' | 'offline' | 'unchecked';
export interface AgentRow {
  id: string; name: string; icon?: string; backend?: string; description?: string;
  agent_type: string; agent_source: string; enabled: boolean; installed: boolean; status: AgentStatus;
  last_check_error_message?: string; last_check_latency_ms?: number;
}

/** 核心内置的原生 Agent 就是 Lom 本身，不单独列出 */
const isLom = (a: AgentRow) => a.agent_source === 'internal';
export const usable = (a?: AgentRow) => !!a && canPin(a);

/** 核心里同一个 Agent 可能有两条（ACP 接入和网关接入）。Lom 用 ACP 启动外部 Agent，同名只留一条：优先 ACP 那条 */
export function dedupeAgents(rows: AgentRow[]): AgentRow[] {
  const rank = (a: AgentRow) => (a.agent_type === 'acp' ? 2 : 0) + (a.backend ? 1 : 0);
  const best = new Map<string, AgentRow>();
  for (const r of rows) {
    const key = r.name.trim().toLowerCase(), prev = best.get(key);
    if (!prev || rank(r) > rank(prev)) best.set(key, r);
  }
  return rows.filter(r => best.get(r.name.trim().toLowerCase()) === r);
}

let loading: Promise<void> | null = null;
export function loadAgents(): Promise<void> {
  loading ??= (async () => {
    try {
      const rows = await api<AgentRow[]>('GET', '/api/agents/management');
      update(s => { s.agentCatalog = dedupeAgents(rows.filter(r => !isLom(r))); s.agentsError = ''; });
    } catch (e) {
      update(s => { s.agentsError = e instanceof Error ? e.message : '读取 Agent 列表失败'; });
    } finally { loading = null; }
  })();
  return loading;
}

/** 测试连接：核心启动一次这个 CLI 并完成握手，不发送任何对话 */
export async function testAgent(id: string) {
  const row = await api<AgentRow>('POST', `/api/agents/${encodeURIComponent(id)}/health-check`, {});
  update(s => { s.agentCatalog = (s.agentCatalog ?? []).map(r => (r.id === id ? row : r)); });
  return row;
}


/** 切换器里的 Agent：用户添加过、且核心仍然认识的 */
export const pinnedAgents = () => S.agentPins.map(id => agentRow(id)).filter((a): a is AgentRow => !!a);

/** 新建会话时传给核心的字段（外部 Agent 走 ACP；模型由该 CLI 自己的设置决定） */
export function acpExtra(a: AgentRow) {
  return { backend: a.backend, agent_id: a.id, agent_name: a.name };
}

/** 输入框对应的外部 Agent 和它的会话：新任务页、外部 Agent 任务、OPC 团队里的本机 Agent 成员（队长的会话记在 leaderConv，由 conversationOf 统一查） */
function externalTarget(ckey: string): { agentId?: string; conv?: Conv; team?: Team } {
  if (ckey === 'home') return { agentId: S.agentPick || undefined };
  if (ckey.startsWith('conv:')) { const conv = S.convs.find(x => x.id === ckey.slice(5)); return { agentId: conv?.agentId, conv }; }
  const pane = paneOf(ckey);
  if (!pane?.m.agent.startsWith('ag:')) return {};
  return { agentId: pane.m.agent.slice(3), conv: conversationOf(pane.t, pane.m), team: pane.t };
}

/** 团队已经开工（在核心里有对应团队或队长会话）。此后窗格找不到会话不是「还没开始」，而是出了问题 */
const teamStarted = (t: Team) => !!(t.real && (t.core || t.leaderConv));
export const TEAM_SESSION_MISSING = 'team.session_missing';
export const teamSessionMissing = () => new CoreError(TEAM_SESSION_MISSING, '团队已开工，但没有找到这个成员正在运行的会话，模型没有改动。请稍后重试，或重新打开这个团队');

/** 输入框所属任务用的外部 Agent 名称；Lom 自己的任务返回空字符串 */
export function externalAgentName(ckey: string): string {
  const { agentId, conv } = externalTarget(ckey);
  return agentId ? conv?.agentName || agentRow(agentId)?.name || '其他 Agent' : '';
}

/** 输入框所属外部 Agent 的模型：标签、选项、当前值（还没有会话时用本机记住的列表和预选） */
export function externalModel(ckey: string) {
  const { agentId, conv, team } = externalTarget(ckey);
  if (!agentId) return null;
  const opts = (conv && S.agentOptions[conv.id]) || cachedOptions(agentId);
  const option = modelOption(opts);
  // 已开工的团队找不到会话：不展示「新任务预选」，那不是这个成员正在用的模型
  const sessionMissing = !conv && !!team && teamStarted(team);
  const current = conv || sessionMissing ? option?.current_value : S.agentModelPick[agentId] || option?.current_value;
  return { agentId, conv, option, current, sessionMissing, label: choiceName(option, current) };
}

/**
 * 输入框所属外部 Agent 的推理强度（每个 Agent 用它 CLI 自己报给核心的选项）。
 * 还没有会话时用本机记住的列表，和预选一致：取不到选项不等于「不支持」——
 * 可能是还没读到，所以用四态区分，不要把「未读到」说成「没有」。
 */
export function externalEffort(ckey: string) {
  const { agentId, conv } = externalTarget(ckey);
  if (!agentId) return null;
  // 空数组代表这次没读到，不能用它覆盖本机缓存并断言「不支持」。
  const live = conv ? S.agentOptions[conv.id] : undefined;
  const liveKnown = !!live?.length;
  const option = effortOption(liveKnown ? live : cachedOptions(agentId));
  const state: 'ready' | 'unloaded' | 'unsupported' = option?.options?.length
    ? (conv && !liveKnown ? 'unloaded' : 'ready')
    : liveKnown ? 'unsupported' : 'unloaded';
  // 预选值必须仍在该 Agent 当前选项里，否则退回它的真实当前值（缓存与实时不一致时不展示旧值）。
  const pick = !conv ? S.agentEffortPick[agentId] : '';
  const current = conv ? option?.current_value
    : pick && option?.options?.some(o => o.value === pick) ? pick : option?.current_value;
  return { agentId, conv, option, current, state, label: choiceName(option, current) };
}
