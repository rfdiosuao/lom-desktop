import { authAccount, onAuthChange } from '@/features/account/runtime/authScope';
import { sendFromChannel } from '@/features/chat/runtime/tasks';
import { ensureConversation } from '@/features/personal/runtime/session';
import { conversationOf, sendToTeam } from '@/features/teams/runtime/team';
import { addPost, beginFlight, retryKeys, setDelivery } from '../chat/posts';
import { chatParticipants, resolveChatTargets, TeamChatError, type ChatParticipant } from '../chat/participants';
import { toast, toastError } from '@/shared/overlays/controller';
import { S, update } from '@/state/store';
import type { Conv, DraftAttachment, Team, TeamChatMeta, TeamChatPost } from '@/state/types';

/* ===== TEAM-CHAT-01 群聊发言：一条发言分别投进每个接收者自己的会话 =====
 * 成员走原有的团队通路（队长 / 成员信箱），个人助理走它自己的会话；群聊不另开执行通路。
 * 每个接收者单独记录成败：被拒是失败可重试，回执丢失是未确认、不自动重发。 */

export const MAX_POST_CHARS = 20_000;

/** 群聊只对团队所属账号开放；旧版没有归属记录的本机团队照常可用 */
export const chatAllowed = (t: Team) => !t.ownerAccountId || t.ownerAccountId === S.account?.id;
// 切换账号时清掉输入框里选中的接收者，不把上一账号的选择带过去（01D）
onAuthChange(() => update(s => { s.teamChatTargets = {}; }));

const metaOf = (t: Team, post: TeamChatPost, targets: ChatParticipant[]): TeamChatMeta => ({
  post: post.id, chain: post.chain, hop: 0, team: t.id, from: { kind: 'user' },
  to: targets.map(p => ({ key: p.key, name: p.name, role: p.role })),
});

/** 投递被拒或回执丢失时，按目标会话里这条消息的真实状态区分「失败」和「未确认」 */
const outcome = (c: Conv | undefined, post: string) =>
  c?.messages.findLast(m => m.teamChat?.post === post)?.status === 'unconfirmed' ? 'unconfirmed' as const : 'failed' as const;

async function deliverToAssistant(p: ChatParticipant, text: string, meta: TeamChatMeta, live: () => boolean) {
  const id = await ensureConversation(p.assistant!);
  const c = S.convs.find(x => x.id === id);
  if (!c) throw new TeamChatError('team.chat_delivery_failed', '助理会话未就绪，请重新打开助理面板');
  if (S.running[c.id]) throw new TeamChatError('team.chat_delivery_failed', `${p.name}正在处理上一条消息，请稍后重试`);
  const sent = await sendFromChannel(c, text, 'team_chat', live, undefined, { teamChat: meta });
  return { ok: !!sent, conv: c };
}

async function deliverOne(t: Team, post: TeamChatPost, p: ChatParticipant, meta: TeamChatMeta, live: () => boolean) {
  try {
    const r = p.assistant
      ? await deliverToAssistant(p, post.text, meta, live)
      : { ok: await sendToTeam(t, p.member!, post.text, [], live, meta), conv: conversationOf(t, p.member!) };
    if (!live()) return;
    setDelivery(post, p.key, r.ok ? { state: 'accepted', conv: r.conv?.id } : { state: outcome(r.conv, post.id), conv: r.conv?.id, error: '投递未被接受，请进成员会话核对' });
  } catch (e) {
    if (!live()) return;
    const code = e instanceof TeamChatError ? e.code : 'team.chat_delivery_failed';
    console.warn(code, { team: t.id, post: post.id, to: p.key });
    setDelivery(post, p.key, { state: 'failed', error: e instanceof Error ? e.message : '投递失败' });
  }
}

/** 逐个投递（同一团队首次组建内核团队时不并发争抢）；返回已接受的接收者数 */
async function deliver(t: Team, post: TeamChatPost, targets: ChatParticipant[], named = targets) {
  const account = authAccount(), live = () => account() && S.teams.includes(t);
  const meta = metaOf(t, post, named);
  // 全部接收者先登记为在途：逐个投递时，还没轮到的不会被当成重启遗留的「投递中」
  const lands = targets.map(p => beginFlight(post.id, p.key));
  for (const [i, p] of targets.entries()) { try { await deliverOne(t, post, p, meta, live); } finally { lands[i](); } }
  return post.deliveries.filter(d => d.state === 'accepted').length;
}

/** 新发言：先校验接收者，再记入索引并投递 */
export async function postTeamChat(t: Team, text: string, keys: readonly string[]) {
  if (text.length > MAX_POST_CHARS) throw new TeamChatError('team.chat_post_too_long', `群聊发言最多 ${MAX_POST_CHARS} 字`);
  const targets = resolveChatTargets(t, keys);
  const post: TeamChatPost = { id: crypto.randomUUID(), at: Date.now(), chain: crypto.randomUUID(), text,
    deliveries: targets.map(p => ({ key: p.key, state: 'pending' })) };
  addPost(t, post);
  await deliver(t, post, targets);
  return post;
}

/** 重试：只对失败的接收者，已接受、未确认的都不再投 */
export async function retryTeamChat(t: Team, post: TeamChatPost) {
  const keys = retryKeys(post);
  if (!keys.length) return 0;
  const all = chatParticipants(t), known = new Set(all.map(p => p.key));
  for (const key of keys) if (!known.has(key)) setDelivery(post, key, { state: 'failed', error: '接收者已不在群聊里' });
  const live = keys.filter(k => known.has(k));
  if (!live.length) return 0;
  const targets = resolveChatTargets(t, live);
  live.forEach(key => setDelivery(post, key, { state: 'pending' }));
  // 信封里的接收者名单仍是这条发言原本的全部接收者
  return deliver(t, post, targets, all.filter(p => post.deliveries.some(d => d.key === p.key)));
}

/** 输入框发送（composer.ts 的 teamchat: 分支）：校验失败保留草稿；发言已记入索引后清空草稿，失败在群聊里重试 */
export async function sendTeamChatDraft(key: string, text: string, atts: DraftAttachment[], takeDraft: () => () => void) {
  const t = S.teams.find(x => x.id === key.slice('teamchat:'.length));
  if (!t?.real) { toast('示例团队不能执行真实任务', 'info'); return; }
  if (!chatAllowed(t)) { toast('这个团队属于其他账号，不能在群聊里发言', 'info'); return; }
  if (atts.length) { toast('群聊暂不支持附件，请在成员窗格里发送附件', 'info'); return; }
  const restore = takeDraft();
  try {
    await postTeamChat(t, text, S.teamChatTargets[t.id] ?? []);
    update(s => { delete s.teamChatTargets[t.id]; });
  } catch (e) { restore(); toastError('发送失败', e); }
}
