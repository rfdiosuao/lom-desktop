import type { Msg } from '@/state/types';
import type { CoreMessage } from '@/core/types';
import { normCallId } from './tools';

const FINAL = new Set(['completed', 'success', 'finish', 'done', 'error', 'failed', 'cancelled', 'canceled']);

/** 首次终态固定结束时间；重复结果不会延长耗时。 */
export function finishTiming(m: Msg, at = Date.now()) {
  if (m.timing && m.timing.endedAt === undefined) m.timing.endedAt = Math.max(m.timing.startedAt, at);
}

export function observeToolTiming(m: Msg, status: string, at: number) {
  if (FINAL.has(status)) finishTiming(m, at);
  else if (!m.timing) m.timing = { startedAt: at };
}

/** 只用明确的发起/结果记录恢复历史；单条终态的创建时间不是开始时间。 */
export function historyToolTiming(items: CoreMessage[]) {
  const calls = new Map<string, Msg>();
  for (const it of items) {
    if (it.type !== 'tool_call' || !Number.isFinite(it.created_at) || it.created_at <= 0) continue;
    const data = it.content || {}, id = normCallId(data.call_id), status = String(data.status || it.status || '');
    if (!id || !status) continue;
    const m = calls.get(id) ?? { id, type: 'tool' as const, at: it.created_at };
    if (FINAL.has(status) || ['running', 'pending', 'work'].includes(status)) observeToolTiming(m, status, it.created_at);
    calls.set(id, m);
  }
  return new Map([...calls].map(([id, m]) => [id, m.timing]));
}

/** 组耗时取最早开始到最后结束的墙钟时间，并行调用不相加。 */
export function elapsedRange(items: Msg[], active: boolean, now: number) {
  const times = items.map(m => m.timing);
  if (!times.length || times.some(t => !t || !Number.isFinite(t.startedAt) || (t.endedAt !== undefined && (!Number.isFinite(t.endedAt) || t.endedAt < t.startedAt)))) return null;
  const known = times as NonNullable<Msg['timing']>[];
  const running = known.some(t => t.endedAt === undefined);
  if (running && !active) return null;
  const start = Math.min(...known.map(t => t.startedAt)), end = Math.max(...known.map(t => t.endedAt ?? now));
  return { milliseconds: Math.max(0, end - start), running };
}

/** 统一向下取整：不足 10 秒的完成耗时保留一位小数（截断），其余按整秒、分、小时截断 */
export function elapsedText(ms: number, running: boolean) {
  const seconds = Math.floor(ms / 1000), minutes = Math.floor(seconds / 60);
  if (minutes >= 60) return `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分` : ''}`;
  if (minutes) return `${minutes} 分${seconds % 60 ? ` ${seconds % 60} 秒` : ''}`;
  return `${!running && ms < 10_000 ? String(Math.floor(ms / 100) / 10) : seconds} 秒`;
}
