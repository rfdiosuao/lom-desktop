import { onAuthChange } from '@/features/account/runtime/authScope';
import { S } from '@/state/store';
import { phoneRunEnded } from './phoneTurn';
import type { Conv } from '@/state/types';

/** TEAM-ORCH-03：同一团队成员收到完全相同的派活正文，而上一次投递的那一轮还没有终态时，不再重复投递。
 *  上一轮一旦有了终态（完成、失败、取消），同样的话（例如“继续”）就是合法的重发。窗口只是兜底：超过它就不再挡。 */
export const TEAM_SEND_DUP_WINDOW_MS = 5 * 60_000;
const MAX_REMEMBERED = 64;

export type SentRecord = { at: number; sessionId?: string };
const sent = new Map<string, SentRecord>();
onAuthChange(() => sent.clear());

const keyOf = (teamId: string, memberId: string, text: string) => `${teamId}\u0000${memberId}\u0000${text.trim()}`;

/** 上一次投递的那一轮是否已经有了平台观测到的终态；看不到会话时按“还没结束”处理。 */
function turnEnded(conv: Conv | undefined, armedAt: number) {
  if (!conv || S.running[conv.id]) return false;
  if (conv.phoneSession) return phoneRunEnded(conv);
  return !!conv.messages.find(m => m.type === 'user' && m.at >= armedAt)?.turnOutcome;
}

/** 窗口内已投递过同样内容、且那一轮还没有终态，就返回那次的记录，否则返回 undefined。 */
export function recentSend(teamId: string, memberId: string, text: string, now = Date.now()): SentRecord | undefined {
  const row = sent.get(keyOf(teamId, memberId, text));
  if (!row || now - row.at >= TEAM_SEND_DUP_WINDOW_MS) return undefined;
  return turnEnded(S.convs.find(c => c.id === row.sessionId), row.at) ? undefined : row;
}

/** 核心确认收下之后才记：投递失败或结果未知时不能挡住用户核对后的重发。at 是派发开始的时刻，用来对上会话里那条用户消息。 */
export function rememberSend(teamId: string, memberId: string, text: string, sessionId: string | undefined, at = Date.now()) {
  const key = keyOf(teamId, memberId, text);
  sent.delete(key); // 先删再放：刷新过的记录要排到队尾，否则会被当作最旧的先淘汰
  sent.set(key, { at, sessionId });
  if (sent.size <= MAX_REMEMBERED) return;
  for (const [k, row] of sent) if (at - row.at >= TEAM_SEND_DUP_WINDOW_MS) sent.delete(k);
  while (sent.size > MAX_REMEMBERED) sent.delete(sent.keys().next().value as string);
}

export const duplicateAgeMinutes = (row: SentRecord, now = Date.now()) => Math.max(0, Math.floor((now - row.at) / 60_000));
