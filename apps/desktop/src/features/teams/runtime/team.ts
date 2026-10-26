import { personalConversation } from '@/features/personal/runtime/catalog';
import { agentRow, type AgentRow } from '@/features/settings/runtime/agents';
import { sendPhone } from '@/features/phones/runtime/phoneChat';
import { getEndpoint } from '@/core/client';
import { sendToCoreTeam } from './coreTeam';
import { S, update } from '@/state/store';
import type { Conv, DraftAttachment, Team, TeamMember } from '@/state/types';

/* ===== OPC 团队（真实执行）=====
 * 跑在内核自带的团队模式上（见 core/coreTeam.ts）：Leader 永远是 Lom 总指挥，带手机工具；
 * 成员可以是手机，也可以是在「设置 → Agents」里检测到的本机 Agent（Codex CLI、Kimi、Pi……）。
 * 本机 Agent 之间用内核的团队工具直接互发消息、分派任务；手机由 Leader 用 phone_* 工具指挥。
 * 你只和 Leader 说目标；Leader 先「开图」（摸清每个成员能做什么），再分派、检查、汇总。 */

/** 成员 ID：'pc' = Lom；手机用设备 ID；本机 Agent 用 'ag:<核心里的 Agent 编号>' */
export const AGENT_PREFIX = 'ag:';
export const isAgentMember = (id: string) => id.startsWith(AGENT_PREFIX);
export const memberAgentRow = (id: string) => (isAgentMember(id) ? agentRow(id.slice(AGENT_PREFIX.length)) : undefined);

/** 本机 Agent 的特长（Leader 开图时直接记下，不用实测） */
const SPECIALTY: Record<string, string> = {
  codex: '能力强，适合控制电脑（Computer Use）、写代码和改文件',
  claude: '适合编程、长任务和写作',
  kimi: '适合看视频、读长文档和网页',
  pi: '适合编程',
  codebuddy: '便宜，适合批量干活',
  gemini: '适合看图、看视频和查资料',
  qwen: '适合中文写作和编程',
};
export const specialty = (a?: AgentRow) => (a?.backend && SPECIALTY[a.backend]) || '通用编程 Agent';

/** 成员的显示信息 */
export function memberInfo(id: string): { name: string; kind: 'lom' | 'phone' | 'agent'; note: string; online: boolean } {
  if (id === 'pc') return { name: 'Lom', kind: 'lom', note: '总指挥（Leader）', online: true };
  const row = memberAgentRow(id);
  if (isAgentMember(id)) return { name: row?.name || '本机 Agent', kind: 'agent', note: specialty(row), online: !!row && row.installed && row.status !== 'missing' };
  const p = S.agents[id];
  return { name: p?.name || '手机', kind: 'phone', note: p?.persona || '手机 Agent', online: p?.status === 'online' };
}

const leaderOf = (t: Team) => t.members.find(m => m.leader) ?? t.members[0];

/** Leader 的团队规则：成员名单 + 成员之间怎么协作 + 先开图再分派 */
export function teamRules(t: Team) {
  const roster = t.members.filter(m => !m.leader && m.agent !== 'pc').map(m => {
    const i = memberInfo(m.agent);
    const how = i.kind === 'phone' ? `手机，设备 ID ${m.agent}，用 phone_* 工具` : '电脑上的 Agent，团队成员，用 team_* 工具协作';
    return `- ${i.name}（角色：${m.role}；${how}；${i.note}）`;
  });
  return [
    `你是 OPC 团队「${t.name}」的 Leader。用户只和你说目标，你负责摸清成员能力、分派、检查和汇总。`,
    '团队成员：', ...(roster.length ? roster : ['（暂时只有你）']),
    '',
    '成员协作：',
    '- 电脑上的 Agent 都是团队成员：用 team_members 查看它们的 slot_id；用 team_task_create（owner 填 slot_id）分派任务，会自动通知并唤醒对方；需要补充说明或转交内容时用 team_send_message。不要用 agent_task_* 给团队成员派活。',
    '- 成员之间可以直接用 team_send_message 互相发消息；收到消息按需处理，不必每条都回复。用户让某个成员把内容（例如写好的提示词）发给另一个成员时，让那个成员自己直接发。',
    '',
    '事实与时效任务（交叉验证）：',
    '- 事实类、时效类或需要引用网页的任务，默认拆给 3–5 名成员并行检索（成员更多可继续加，不设上限），不要只问一个人。',
    '- 每个成员都必须调用联网搜索：外部 Agent 用 lom_search，Lom 原生会话用 LomWebSearch；回复必须包含结论、关键证据和来源 URL。没有来源的结论不得当作事实。',
    '- 汇总时必须逐条标注「一致」「冲突」「仅一家」：至少两个独立来源相互印证才能写“一致”；冲突要说明取舍和原因；只有一家有来源时明确标注，不得当作共识。',
    '',
    '每次收到用户的命令，第一件事是「开图」：',
    '1. 先读工作文件夹里的 TEAM.md（团队能力图）。没有这个文件、超过 24 小时没更新、或成员有变化时，重新开图。',
    '2. 手机成员：用 phone_status 看在线、电量和网络；用 phone_apps 看装了哪些应用、无障碍是否开启；和这次任务相关的应用（例如美团、淘宝、抖音、小红书、微信），用 phone_task_start 让那台手机打开查看是否已登录——只看不操作——再用 phone_task_read 读结果。例：美团已登录的手机可以点外卖、代购。',
    '3. 电脑上的 Agent：不用实测，按名单里的特长记下即可（Codex CLI 适合控制电脑，Kimi 适合看视频，Pi 适合编程，CodeBuddy 便宜适合干活）。',
    '4. 把能力图写进 TEAM.md：每个成员能做什么、不能做什么、哪些应用已登录、电量、权限、更新时间。',
    '',
    '然后按能力图拆分任务：手机用 phone_task_start，派出去后用 phone_task_read 检查真实结果，accepted 不等于完成；电脑上的 Agent 用 team_task_create，它们做完会通知你，再用 team_task_list 和成员的回复核对结果。',
    '最后把各成员的结果汇总给用户。付款、下单、发布、私信等对外操作必须先问用户。',
  ].join('\n');
}

/** 成员名单改了之后，下一条发给 Leader 的消息带上最新名单（隐藏块，历史里不显示）；没变就不重复带 */
export function rosterContext(t: Team) {
  const rules = teamRules(t);
  if (t.rosterSent === rules) return '';
  return `[LOM_TEAM_V1]\n${rules}\n[/LOM_TEAM_V1]\n\n`;
}
/** 核心收下带名单的消息后才记为已送达：发送失败时下次还会带上最新名单 */
export const rosterDelivered = (t: Team, block: string) => { if (block) update(() => { t.rosterSent = teamRules(t); }); };

/** 团队工作文件夹：没选就用当前工作文件夹 */
export function teamFolder(t: Team) {
  const home = S.homeDir || getEndpoint()?.homeDir || '';
  const f = t.folder?.startsWith('~/') && home ? `${home}${t.folder.slice(1)}` : t.folder;
  return f && f.startsWith('/') ? f : S.folder || getEndpoint()?.defaultFolder || '';
}

export const phonesOf = (t: Team) => t.members.map(m => m.agent).filter(id => S.agents[id]?.real);

/** 在某个成员的窗格里发送：Leader 和本机 Agent → 内核团队（见 coreTeam.ts）；手机 → 这台手机的团队会话 */
export async function sendToTeam(t: Team, m: TeamMember, text: string, atts: DraftAttachment[]): Promise<boolean> {
  if (m.leader || m.agent === 'pc') return sendToCoreTeam(t, leaderOf(t), text, atts);
  if (isAgentMember(m.agent)) {
    if (!memberAgentRow(m.agent)) throw new Error('这个 Agent 在本机已找不到，请到「设置 → Agents」检查');
    return sendToCoreTeam(t, m, text, atts);
  }
  const existing = conversationOf(t, m);
  if (existing) { await sendPhone(existing, text, atts); return true; }
  if (!S.agents[m.agent]?.real) throw new Error('示例手机不能执行真实任务');
  const c: Conv = { id: crypto.randomUUID(), owner: m.agent, title: `${t.name} · ${m.role}`, updated: Date.now(), messages: [], teamId: t.id };
  update(s => { s.convs.unshift(c); (t.memberConvs ||= {})[m.mid] = c.id; });
  await sendPhone(c, text, atts);
  return true;
}

/** 团队窗格的输入框 key（team:<团队>:<成员>）→ 团队和成员 */
export function paneOf(key: string): { t: Team; m: TeamMember } | undefined {
  if (!key.startsWith('team:')) return undefined;
  const [, tid, mid] = key.split(':');
  const t = S.teams.find(x => x.id === tid), m = t?.members.find(x => x.mid === mid);
  return t && m ? { t, m } : undefined;
}

/** 输入框 key 对应的会话：任务页 conv:<id>，团队窗格是这个成员的会话（还没开始时为空） */
export function convOfKey(key: string): Conv | undefined {
  if (key.startsWith('personal:')) return personalConversation(key);
  if (key.startsWith('conv:')) return S.convs.find(c => c.id === key.slice(5));
  const p = paneOf(key);
  return p ? conversationOf(p.t, p.m) : undefined;
}

/** 团队窗格里能不能用电脑端的 AI 功能（技能、提问卡）：真实团队里的 Lom 或电脑 Agent 成员 */
export const paneIsDesktop = (key: string) => { const p = paneOf(key); return !!p?.t.real && memberInfo(p.m.agent).kind !== 'phone'; };

/** 成员窗格对应的会话 */
export function conversationOf(t: Team, m: TeamMember): Conv | undefined {
  const id = m.leader || m.agent === 'pc' ? t.leaderConv : t.memberConvs?.[m.mid];
  return id ? S.convs.find(c => c.id === id) : undefined;
}

/** Leader 派活时，把派出的会话记到对应成员的窗格上 */
export function recordDelegation(leaderConvId: string, member: string, convId: string) {
  const t = S.teams.find(x => x.leaderConv === leaderConvId);
  const m = t?.members.find(x => x.agent === member && !x.leader);
  if (t && m) update(() => { (t.memberConvs ||= {})[m.mid] = convId; });
}

export const leaderMember = leaderOf;
