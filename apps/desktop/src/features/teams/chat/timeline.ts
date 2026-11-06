import { conversationOf, isLegacyLeaderAlias } from '@/features/teams/runtime/team';
import type { Conv, Msg, Team, TeamChatPost } from '@/state/types';
import type { TeamMailboxMessage, TeamTask } from '../activity/activityTypes';
import { assistantKey, EVERYONE, memberKey } from './participants';

/* ===== TEAM-CHAT-01 群聊时间线：从各会话和核心信箱投影出来，不另存回复 =====
 * - 发言：发言索引 + 会话里带群聊信封的用户消息（个人助理派的活也在这里，发送者是助理）；
 * - 回复：接收者会话里被某条来信触发的消息，按消息标识原样引用；来信之间按轮次切开；
 * - 成员协作（01B）：核心信箱里的成员消息、完成通知和任务，slot 编号映射到成员，不按名字；
 * - 完成提醒（01B）：个人助理会话里的派发完成提醒，按提醒里的会话标识对应成员；
 * - 单独对话：成员窗格里直接发的消息也显示（§9-⑤）；个人助理的私聊不进群聊。
 * 同一发言在同一会话里只认第一条，之后的重复记录忽略。 */

export interface ChatSource { key: string; conv: Conv; assistant: boolean }
export type Outcome = Msg['turnOutcome'];
export type TimelineItem =
  | { kind: 'post'; id: string; at: number; post: TeamChatPost }
  | { kind: 'direct'; id: string; at: number; source: ChatSource; message: Msg }
  | { kind: 'reply'; id: string; at: number; source: ChatSource; msgs: Msg[]; post?: string }
  | { kind: 'mail'; id: string; at: number; from?: string; to?: string; message: TeamMailboxMessage; outcome?: Outcome }
  | { kind: 'task'; id: string; at: number; owner?: string; task: TeamTask }
  | { kind: 'report'; id: string; at: number; from: string; to: string; message: Msg; outcome?: Outcome };

export interface TeamActivity { messages: readonly TeamMailboxMessage[]; tasks: readonly TeamTask[] }

/** 群聊要读的会话：队长、各成员（同一会话只读一次）和加入群聊的个人助理 */
export function chatSources(t: Team, convs: Conv[], assistantConv?: string): ChatSource[] {
  const out: ChatSource[] = [], seen = new Set<string>();
  for (const m of t.members) {
    if (isLegacyLeaderAlias(t, m)) continue;
    const c = conversationOf(t, m);
    if (c && !seen.has(c.id)) { seen.add(c.id); out.push({ key: memberKey(m), conv: c, assistant: false }); }
  }
  const pa = assistantConv ? convs.find(c => c.id === assistantConv && c.personal) : undefined;
  if (pa && !seen.has(pa.id)) out.push({ key: assistantKey(pa.personal!.id), conv: pa, assistant: true });
  return out;
}

const synthesized = (m: Msg): TeamChatPost => ({ id: m.teamChat!.post, at: m.at, chain: m.teamChat!.chain, text: m.text || '',
  from: m.teamChat!.from, hop: m.teamChat!.hop, deliveries: m.teamChat!.to.map(r => ({ key: r.key, state: 'accepted' as const })) });

/** 这一轮的终态：只认 at 之前最近一条来信是用户消息的情况；之后若是成员来信，终态不可信，不显示 */
export function outcomeBefore(c: Conv | undefined, at: number): Outcome {
  const inbound = c?.messages.filter(m => (m.type === 'user' || m.type === 'teammate') && m.at <= at).at(-1);
  return inbound?.type === 'user' ? inbound.turnOutcome : undefined;
}

interface Ctx { t: Team; posts: Map<string, TeamChatPost>; claimed: Set<string>; out: TimelineItem[]; inbound: Map<string, number[]>; members: Map<string, string> }

/** 一条用户消息在群聊里怎么出现；返回回复要挂在谁下面（'skip' 表示后面的回复不进群聊） */
function anchorOf(c: Ctx, s: ChatSource, m: Msg): { post?: string; id: string } | 'skip' {
  const meta = m.teamChat?.team === c.t.id ? m.teamChat : undefined;
  if (s.assistant && !meta) {
    const from = m.source === 'dispatch_done' && m.dispatchOf ? c.members.get(m.dispatchOf) : undefined;
    if (!from) return 'skip';
    c.out.push({ kind: 'report', id: `${s.conv.id}:${m.id}`, at: m.at, from, to: s.key, message: m });
    return { id: m.id };
  }
  if (!meta) { c.out.push({ kind: 'direct', id: `${s.conv.id}:${m.id}`, at: m.at, source: s, message: m }); return { id: m.id }; }
  const claim = `${s.conv.id}:${meta.post}`;
  if (c.claimed.has(claim)) { console.warn('team.chat_post_duplicate', { conv: s.conv.id, post: meta.post }); return 'skip'; }
  c.claimed.add(claim);
  if (!c.posts.has(meta.post)) c.posts.set(meta.post, synthesized(m));
  return { post: meta.post, id: m.id };
}

function project(c: Ctx, s: ChatSource) {
  let anchor: ReturnType<typeof anchorOf> | null = null, reply: Extract<TimelineItem, { kind: 'reply' }> | undefined, lastAt = 0;
  const marks = c.inbound.get(s.key) ?? [];
  for (const m of s.conv.messages) {
    if (m.type === 'user' || m.type === 'teammate') {
      reply = undefined;
      anchor = m.type === 'teammate' ? { id: m.id } : anchorOf(c, s, m); // 成员来信本身由信箱呈现，这里只承接它触发的回复
      continue;
    }
    if (!anchor || anchor === 'skip') continue;
    // 核心信箱里有新来信（完成通知、派活）落在两条消息之间：说明是新的一轮，另起一段
    if (reply && marks.some(at => at > lastAt && at <= m.at)) reply = undefined;
    if (!reply) {
      reply = { kind: 'reply', id: `${s.conv.id}:${m.id}`, at: m.at, source: s, msgs: [], post: anchor.post };
      c.out.push(reply);
    }
    reply.msgs.push(m);
    lastAt = m.at;
  }
}

function addActivity(c: Ctx, activity: TeamActivity | undefined, sources: ChatSource[]) {
  const bySlot = new Map(Object.entries(c.t.core?.slots ?? {}).map(([mid, slot]) => [slot, `m:${mid}`] as const));
  const key = (slot?: string | null) => (slot === '*' ? EVERYONE : slot ? bySlot.get(slot) : undefined);
  const mark = (k: string | undefined, at: number) => { if (k) c.inbound.set(k, [...(c.inbound.get(k) ?? []), at]); };
  for (const message of activity?.messages ?? []) {
    const from = key(message.from_agent_id), to = key(message.to_agent_id);
    const conv = sources.find(s => s.key === from)?.conv;
    c.out.push({ kind: 'mail', id: `mail:${message.id}`, at: message.created_at, from, to, message,
      outcome: message.msg_type === 'idle_notification' ? outcomeBefore(conv, message.created_at) : undefined });
    if (to === EVERYONE) sources.forEach(s => { if (!s.assistant && s.key !== from) mark(s.key, message.created_at); });
    else mark(to, message.created_at);
  }
  for (const task of activity?.tasks ?? []) {
    const owner = key(task.owner);
    c.out.push({ kind: 'task', id: `task:${task.id}`, at: task.created_at, owner, task });
    mark(owner, task.created_at);
  }
}

export function teamChatTimeline(t: Team, sources: ChatSource[], activity?: TeamActivity): TimelineItem[] {
  const members = new Map(sources.filter(s => !s.assistant).map(s => [s.conv.id, s.key] as const));
  const c: Ctx = { t, posts: new Map((t.chatPosts ?? []).map(p => [p.id, p] as const)), claimed: new Set(), out: [], inbound: new Map(), members };
  addActivity(c, activity, sources);
  for (const s of sources) project(c, s);
  for (const item of c.out) if (item.kind === 'report') item.outcome = outcomeBefore(sources.find(s => s.key === item.from)?.conv, item.at);
  for (const post of c.posts.values()) c.out.push({ kind: 'post', id: post.id, at: post.at, post });
  // 同一时刻发言排在其他内容前面；其余按观测时间
  return c.out.sort((a, b) => a.at - b.at || (a.kind === 'post' ? -1 : b.kind === 'post' ? 1 : 0));
}
