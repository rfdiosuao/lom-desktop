import { loadAssistants, type PersonalAssistant } from '@/features/personal/runtime/catalog';
import { isLegacyLeaderAlias, leaderMember, memberAgentRow, memberInfo } from '@/features/teams/runtime/team';
import { S } from '@/state/store';
import type { Team, TeamMember } from '@/state/types';

/* ===== TEAM-CHAT-01 群聊成员 =====
 * 群聊成员 = 团队执行成员（按 mid）+ 用户为这个团队选的 0～1 位个人助理（按助理 id）。
 * 身份键：成员 `m:<mid>`，个人助理 `pa:<id>`。路由只用身份键，不用显示名，同名成员也不会串。 */

export class TeamChatError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'TeamChatError'; }
}

export interface ChatParticipant {
  key: string; name: string; role: string; leader: boolean;
  member?: TeamMember; assistant?: PersonalAssistant;
  /** 不可投递的原因；为空表示可以投递 */
  blocked?: string;
  /** 只用于历史里的发送者：这位个人助理已不在本机目录里（被删除）；recordedName 是发言当时信封里记下的名字 */
  removed?: boolean; recordedName?: string;
}

export const memberKey = (m: TeamMember) => `m:${m.mid}`;
export const assistantKey = (id: string) => `pa:${id}`;

/** 当前账号下这位助理的配置；没登录、已删除或配置读不出时返回 undefined（由调用方说明不可用） */
export function chatAssistantOf(t: Team): PersonalAssistant | undefined {
  if (!t.chatAssistant || S.cloud !== 'signed-in' || !S.account) return undefined; // 没登录时个人助理本来就不可用
  try { return loadAssistants().items.find(a => a.id === t.chatAssistant); }
  catch (e) { console.warn('team.chat_assistant_unavailable', e instanceof Error ? e.message : e); return undefined; }
}

/** 当前账号的个人助理目录；没登录或读不出来时返回 undefined——这时不能断言某位助理已被删除（TEAM-CHAT-01E） */
export function assistantDirectory(): PersonalAssistant[] | undefined {
  if (S.cloud !== 'signed-in' || !S.account) return undefined;
  try { return loadAssistants().items; }
  catch (e) { console.warn('team.chat_assistant_unavailable', e instanceof Error ? e.message : e); return undefined; }
}

/** 历史里个人助理发送者的身份：按 id 取目录里的当前名称和头像，不要求它是群聊成员（TEAM-CHAT-01E）。
 *  目录读得出来而没有这个 id 才算已移除；读不出来时用信封里记下的名字，不冒充「已删除」。 */
export function assistantSender(id: string, directory: PersonalAssistant[] | undefined, recordedName?: string): ChatParticipant {
  const base = { key: assistantKey(id), role: '个人助理', leader: false };
  const assistant = directory?.find(a => a.id === id);
  if (assistant) return { ...base, name: assistant.name, assistant };
  if (!directory) return { ...base, name: recordedName ?? '个人助理' };
  return { ...base, name: '已移除的助理', removed: true, recordedName };
}

function memberBlock(m: TeamMember) {
  const info = memberInfo(m.agent);
  if (info.kind === 'phone') return '手机成员暂不支持群聊投递，请在并排视图里直接发给它';
  if (info.kind === 'agent' && !memberAgentRow(m.agent)) return '这个 Agent 在本机已找不到，请到「设置 → Agents」检查';
  return undefined;
}

export function chatParticipants(t: Team): ChatParticipant[] {
  const members = t.members.filter(m => !isLegacyLeaderAlias(t, m)).map(m => ({
    key: memberKey(m), name: memberInfo(m.agent).name, role: m.role, leader: !!m.leader, member: m, blocked: memberBlock(m),
  }));
  const a = chatAssistantOf(t);
  return a ? [...members, { key: assistantKey(a.id), name: a.name, role: '个人助理', leader: false, assistant: a }] : members;
}

export const EVERYONE = 'all';

/** 输入框里选中的接收者 → 实际接收者。没选任何人时发给队长（§9-①），绝不默认广播。
 *  @所有人展开为全部执行成员（不含个人助理，§9-④），与单独选中的成员按身份键去重；
 *  其中不可投递的成员照样列入，投递时逐个记为未送达，不拖住其他人。单独选中的不可投递成员直接拒发。 */
export function resolveChatTargets(t: Team, keys: readonly string[]): ChatParticipant[] {
  const all = chatParticipants(t), out = new Map<string, ChatParticipant>();
  const wanted = keys.length ? [...new Set(keys)] : [memberKey(leaderMember(t))];
  for (const key of wanted) {
    if (key === EVERYONE) { for (const p of all) if (p.member && !out.has(p.key)) out.set(p.key, p); continue; }
    const p = all.find(x => x.key === key);
    if (!p) throw new TeamChatError(key.startsWith('pa:') ? 'team.chat_assistant_unavailable' : 'team.chat_recipient_missing',
      key.startsWith('pa:') ? '这位个人助理已不可用，请重新选择' : '提及的成员已不在这个团队里，请重新选择');
    if (p.blocked) throw new TeamChatError('team.chat_member_unavailable', `${p.name}：${p.blocked}`);
    out.set(p.key, p);
  }
  return [...out.values()];
}
