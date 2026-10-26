import { api } from '@/core/client';
import { update, S } from '@/state/store';
import { coreTeamOf } from '@/state/selectors';
import type { Conv } from '@/state/types';

/* ===== 外部 Agent（Codex CLI 等）的模型：用它自己配置好的模型，也能在输入框右下角切换 =====
 * 模型列表由该 CLI 在会话开始时报给核心（config_options 里 category = model）。
 * 新任务页还没有会话：选 Agent 时开一个不发消息的临时会话读一次列表并记在本机。 */

export interface AgentChoice { value: string; name?: string; description?: string }
export interface AgentOption { id: string; name?: string; category?: string; current_value?: string | null; options: AgentChoice[] }

const KEY = (agentId: string) => `lom.agent-options:${agentId}`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const modelOption = (opts?: AgentOption[]) => opts?.find(o => o.category === 'model' || o.id === 'model');

/** 归一化 id/category，让 thoughtLevel、model_reasoning_effort 这类写法也能匹配 */
const norm = (v?: string) => (v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** 推理强度选项：CLI 自己报给核心的配置项。
 *  归一化后包含 `thoughtlevel` / `reasoningeffort` / `effort` / `thinking`，
 *  因此 `model_reasoning_effort`、`model_thought_level` 这类带前缀的键也能匹配。 */
const EFFORT_KEYS = ['thoughtlevel', 'reasoningeffort', 'effort', 'thinking'];
export const effortOption = (opts?: AgentOption[]) => opts?.find(o => {
  const id = norm(o.id), cat = norm(o.category);
  return EFFORT_KEYS.some(k => id.includes(k) || cat.includes(k));
});

export function cachedOptions(agentId?: string): AgentOption[] | undefined {
  if (!agentId) return undefined;
  try { const v = JSON.parse(localStorage.getItem(KEY(agentId)) || 'null'); return Array.isArray(v) ? v : undefined; }
  catch { return undefined; }
}
function remember(agentId: string, opts: AgentOption[]) {
  try { localStorage.setItem(KEY(agentId), JSON.stringify(opts)); } catch { /* 隐私模式：下次重新读取 */ }
}

/** 等会话把模型列表报上来（通常 1–3 秒）；拿不到就返回已有的 */
async function ensureOptions(convId: string): Promise<AgentOption[]> {
  // 内核团队里的会话由团队运行时管理，不能单独启动；读团队接口给的当前选项
  const t = coreTeamOf(convId);
  if (t?.core) return (await api<{ config_options?: AgentOption[] }>('GET', `/api/teams/${t.core.id}/conversations/${convId}/config-options`)).config_options || [];
  let opts: AgentOption[] = [];
  for (let i = 0; i < 10; i++) {
    const r = await api<{ config_options?: AgentOption[] }>('POST', `/api/conversations/${convId}/runtime/ensure`, {});
    opts = r.config_options || [];
    if (modelOption(opts)) break;
    await sleep(1500);
  }
  return opts;
}

/** 打开外部 Agent 的任务时读取它当前的模型 */
const loading = new Set<string>();
export async function loadConvOptions(c: Conv) {
  if (!c.agentId || loading.has(c.id)) return;
  loading.add(c.id);
  try {
    const opts = await ensureOptions(c.id);
    update(s => { s.agentOptions[c.id] = opts; });
    if (modelOption(opts)) remember(c.agentId, opts);
  } catch (e) {
    console.warn('agent.options_failed', e instanceof Error ? e.message : e);
  } finally { loading.delete(c.id); }
}

/** 新任务页：开一个不发消息的临时会话读取模型列表，读完就删 */
const probing = new Set<string>();
export async function probeAgentOptions(agent: { id: string; name: string; backend?: string }) {
  if (probing.has(agent.id)) return;
  probing.add(agent.id);
  let id = '';
  try {
    const c = await api<{ id: string }>('POST', '/api/conversations', {
      type: 'acp', name: 'lom-probe', extra: { backend: agent.backend, agent_id: agent.id, agent_name: agent.name, lom_probe: true },
    });
    id = c.id;
    const opts = await ensureOptions(id);
    if (modelOption(opts)) { remember(agent.id, opts); update(); }
  } catch (e) {
    console.warn('agent.probe_failed', e instanceof Error ? e.message : e);
  } finally {
    probing.delete(agent.id);
    if (id) await api('DELETE', `/api/conversations/${id}`).catch(e => console.warn('agent.probe_cleanup_failed', e));
  }
}
export const isProbing = (agentId: string) => probing.has(agentId);

/** 部分响应只更新对应项，不能把 model 等其他选项挤掉 */
function mergeOptions(prev: AgentOption[] | undefined, next: AgentOption[]) {
  if (!prev?.length) return next;
  const byId = new Map(prev.map(o => [o.id, o]));
  for (const o of next) byId.set(o.id, o);
  return [...byId.values()];
}

/** 已有任务里切换（模型、思考强度等）；有的 CLI 下一轮才生效。
 *  `confirmation` 取值：`observed` 已确认生效 · `pending_next_turn` / `next_turn` 下一轮生效 ·
 *  `command_ack` 命令已接受但无法确认是否生效 —— 后两种不能用「已切换」的语气回报。
 *  只有核心明确返回 observed，且本次 `config_options` 的目标项回显所选值，才报 observed；
 *  没有回显就保留旧值，界面不能假装已生效。 */
export async function setConvOption(c: Conv, optionId: string, value: string) {
  const t = coreTeamOf(c.id);
  const base = t?.core ? `/api/teams/${t.core.id}/conversations/${c.id}` : `/api/conversations/${c.id}`;
  const r = await api<{ confirmation?: string; config_options?: AgentOption[] | null }>('PUT', `${base}/config-options/${encodeURIComponent(optionId)}`, { value });
  // 未确认时保留目标项旧值；其他回传项仍可合并，不能把请求值当生效值。
  const confirmed = ['observed', 'pending_next_turn', 'next_turn'].includes(r.confirmation || '');
  const incoming = r.config_options?.filter(o => confirmed || o.id !== optionId);
  const merged = incoming ? mergeOptions(S.agentOptions[c.id], incoming) : undefined;
  if (merged) {
    update(s => { s.agentOptions[c.id] = merged; });
    if (c.agentId) remember(c.agentId, merged);
  }
  // 核心明确说下一轮才生效时，即使回显已是新值也不能报「已生效」。
  if (r.confirmation === 'pending_next_turn' || r.confirmation === 'next_turn') return r.confirmation;
  // Only this response can confirm this request; merged options may contain stale cache.
  const echoed = r.config_options?.find(o => o.id === optionId)?.current_value;
  if (r.confirmation === 'observed' && echoed === value) return 'observed';
  return 'command_ack';
}

/** 选项的显示名 */
export const choiceName = (o: AgentOption | undefined, value?: string | null) =>
  (value && (o?.options.find(x => x.value === value)?.name || value)) || '';
