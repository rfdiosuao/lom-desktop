import { conversationOf, memberInfo } from '@/features/teams/runtime/team';
import type { Conv, Team, TeamChatMeta, TeamMember } from '@/state/types';
import { MAX_HOP } from './envelope';
import { memberKey, TeamChatError } from './participants';

/* ===== TEAM-CHAT-01B 个人助理派活的协作链与跳数 =====
 * 助理这一轮由哪条消息触发，就属于哪条链：群聊发言沿用发言的链；私聊触发的轮次以那条消息为链。
 * 完成提醒、手机回执只是结果回报，不开新链、不加跳数（规格 §2.6）。
 * 跳数 = 这条链上已经由助理投出的派活条数 + 1，从各成员会话里带信封的消息数出来，重启后仍成立。 */

const NOTICE = new Set(['dispatch_done', 'phone_receipt']);

function chainOf(t: Team, self: Conv) {
  const trigger = self.messages.findLast(m => m.type === 'user' && !NOTICE.has(m.source ?? ''));
  if (trigger?.teamChat?.team === t.id) return trigger.teamChat.chain;
  return `pa-${trigger?.remoteId ?? trigger?.id ?? self.id}`.replace(/[^\w:.-]/g, '_').slice(0, 120);
}

function usedHops(t: Team, chain: string) {
  const posts = new Set<string>();
  for (const m of t.members) for (const msg of conversationOf(t, m)?.messages ?? []) {
    const meta = msg.type === 'user' ? msg.teamChat : undefined;
    if (meta?.chain === chain && meta.from.kind === 'personal') posts.add(meta.post);
  }
  return posts.size;
}

/** 群聊里的个人助理给成员派活时附带的信封；助理不在这个团队的群聊里时返回 undefined（行为与以前一致） */
export function assistantDispatchMeta(t: Team, self: Conv, member: TeamMember): TeamChatMeta | undefined {
  const id = self.personal?.id;
  if (!id || t.chatAssistant !== id) return undefined;
  const chain = chainOf(t, self), hop = usedHops(t, chain) + 1;
  if (hop > MAX_HOP) throw new TeamChatError('team.hop_limit', `这条协作链已派活 ${MAX_HOP} 次，已停止自动派活；请等用户在群聊里给出新的指示`);
  if (memberInfo(member.agent).kind === 'phone') return undefined; // 手机走手机会话，群聊投递暂不支持，保持原派发方式
  return { post: crypto.randomUUID(), chain, hop, team: t.id, from: { kind: 'personal', id, ...(self.personal?.name ? { name: self.personal.name.slice(0, 80) } : {}) },
    to: [{ key: memberKey(member), name: memberInfo(member.agent).name, role: member.role }] };
}
