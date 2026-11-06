import type { Conv, Msg } from '@/state/types';
import { memberWait } from '../activity/memberWait';

/* ===== TEAM-CHAT-01C 群聊成员状态：只由观测到的事实推出 =====
 * 输入中 = 正文正在流式；执行中 = 有运行中的工具；等待确认 = 有待处理的授权或提问；
 * 完成 / 失败 / 已取消 = 平台记下的这一轮终态；结果未确认 = 发送或停止结果未知；
 * 断线时正在运行的成员一律显示「状态待核对」，不继续显示正在工作。没有终态时不显示完成。 */

export type MemberStatus = 'typing' | 'tool' | 'waiting' | 'running' | 'disconnected' | 'unconfirmed' | 'completed' | 'failed' | 'cancelled' | 'idle';

export const STATUS_TEXT: Record<MemberStatus, string> = {
  typing: '输入中', tool: '执行中', waiting: '等待确认', running: '等待回复', disconnected: '断线待核对',
  unconfirmed: '结果未确认', completed: '完成', failed: '失败', cancelled: '已取消', idle: '空闲',
};

/** 这些状态伴随轻量加载动画；其余状态动画必须停下 */
export const isWorking = (s: MemberStatus) => s === 'typing' || s === 'tool' || s === 'running';

export interface StatusFacts { running: boolean; connected: boolean; unsettled: boolean }

const inbound = (m: Msg) => m.type === 'user' || m.type === 'teammate';

export function memberStatus(c: Conv | undefined, f: StatusFacts): MemberStatus {
  if (!c) return 'idle';
  const wait = memberWait(c);
  if (wait && wait.message.status !== 'unconfirmed') return 'waiting';
  if (f.running && !f.connected) return 'disconnected';
  const start = c.messages.findLastIndex(inbound);
  const turn = c.messages.slice(start + 1);
  if (f.running) {
    if (turn.some(m => m.type === 'tool' && m.status === 'running')) return 'tool';
    return turn.some(m => m.type === 'assistant' && m.streaming) ? 'typing' : 'running';
  }
  const last = c.messages[start];
  if (wait || f.unsettled || last?.status === 'unconfirmed') return 'unconfirmed';
  return (last?.type === 'user' && last.turnOutcome) || 'idle';
}
