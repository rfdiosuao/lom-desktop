/* ===== REFACTOR-01 模块 5（#280）：渠道消息去重，飞书与微信共用 =====
 * 原来只有飞书有去重（feishuDedup），微信同一条消息在重连或回执丢失后被重投时会再次派给助理。
 * 规则（原飞书规则不变）：
 * - 预留：同一渠道、同一助理（飞书还区分应用）下的消息 ID，只有一个处理者；不包含连接代次，跨重连重投仍算同一条。
 * - 提交：真正派发（发送请求发出）时才提交；提交后的重投一律丢弃，结果未知也不重发。
 * - 释放：还没派发就失效（旧代次、换账号、会话解绑）的预留会被释放或被新代次接管，不吞掉新代的重投。
 * 只保存标识，不保存消息内容。 */

export type Channel = 'feishu' | 'wechat';
type Entry = { dispatched: boolean; current?: () => boolean };
const histories = new Map<string, Map<string, Entry>>();
const MAX_SCOPES = 64, MAX_MESSAGES = 500;

export interface Reservation { dispatched: () => void; releaseUnsent: () => void }

/** scope：账号、助理，以及渠道自己的身份（如飞书应用 ID）；不要放连接代次 */
export function reserveChannelMessage(channel: Channel, scope: string[], messageId: string, current: () => boolean): Reservation | null {
  const key = JSON.stringify([channel, ...scope]);
  const seen = histories.get(key) ?? new Map<string, Entry>();
  const previous = seen.get(messageId);
  if (previous && (previous.dispatched || previous.current?.())) return null;
  histories.delete(key); histories.set(key, seen);
  const entry: Entry = { dispatched: false, current };
  seen.delete(messageId); seen.set(messageId, entry);
  if (seen.size > MAX_MESSAGES) seen.delete(seen.keys().next().value!);
  if (histories.size > MAX_SCOPES) histories.delete(histories.keys().next().value!);
  return {
    dispatched: () => { entry.dispatched = true; delete entry.current; },
    releaseUnsent: () => { if (!entry.dispatched && seen.get(messageId) === entry) seen.delete(messageId); },
  };
}

/** 换账号等认证变化时清空；只清指定渠道或全部 */
export function clearChannelHistory(channel?: Channel) {
  if (!channel) { histories.clear(); return; }
  for (const key of [...histories.keys()]) if (JSON.parse(key)[0] === channel) histories.delete(key);
}
