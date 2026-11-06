import { update } from '@/state/store';
import type { Conv, Team, TeamChatDelivery, TeamChatPost } from '@/state/types';

/* ===== TEAM-CHAT-01 群聊发言索引 =====
 * 每个团队最多 200 条，随团队配置保存在本机：记下发给了谁、每个接收者投递到哪个会话、成没成。
 * 成员回复不存这里，群聊显示时从成员会话里读（规格 §2.1）。 */

export const MAX_POSTS = 200;

export function addPost(t: Team, post: TeamChatPost) {
  update(() => {
    const list = [...(t.chatPosts ?? []), post];
    const dropped = list.length - MAX_POSTS;
    if (dropped > 0) console.warn('team.chat_index_evicted', { team: t.id, dropped });
    t.chatPosts = dropped > 0 ? list.slice(dropped) : list;
  });
}

export function setDelivery(post: TeamChatPost, key: string, next: Omit<TeamChatDelivery, 'key'>) {
  update(() => {
    const d = post.deliveries.find(x => x.key === key);
    if (!d) return;
    d.state = next.state;
    if (next.conv) d.conv = next.conv;
    if (next.error) d.error = next.error; else delete d.error;
  });
}

/** 重试只补投还没被接受的接收者（规格 §2.3-13） */
export const retryKeys = (post: TeamChatPost) => post.deliveries.filter(d => d.state === 'failed').map(d => d.key);

/* 01D：本进程里正在投递的接收者。索引里的「投递中」若不在这里，说明应用在投递途中关闭或重启过，
 * 不能一直显示进行中：按成员会话里的事实结算——有带这条发言信封的消息就是已接受，否则记为未确认，不自动重发。 */
const inflight = new Set<string>();
const flightKey = (post: string, key: string) => `${post}:${key}`;
export function beginFlight(post: string, key: string) { inflight.add(flightKey(post, key)); return () => { inflight.delete(flightKey(post, key)); }; }

/** sources：接收者身份键 → 它的会话；会话还没加载完时先不结算，避免把已送达的误判为未确认 */
export function settleStalePending(t: Team, sources: ReadonlyMap<string, Conv>) {
  const stale = (t.chatPosts ?? []).flatMap(post => post.deliveries.filter(d => d.state === 'pending' && !inflight.has(flightKey(post.id, d.key))).map(d => ({ post, d })));
  for (const { post, d } of stale) {
    const conv = sources.get(d.key);
    if (conv && !conv.loaded) continue;
    const seen = conv?.messages.some(m => m.type === 'user' && m.teamChat?.post === post.id);
    if (!seen) console.warn('team.chat_delivery_unconfirmed', { team: t.id, post: post.id, to: d.key });
    setDelivery(post, d.key, seen ? { state: 'accepted', conv: conv!.id } : { state: 'unconfirmed', error: '投递途中应用关闭或重启，结果未知，未自动重发' });
  }
}
