import { onAuthChange } from '@/features/account/runtime/authScope';
import type { CommanderCall } from '@/core/remoteWire';
import type { Result } from './sessionTools';
type Pending = { args: string; current: () => boolean; result: Promise<Result>; settled: boolean };
const calls = new Map<string, Pending>();
const targets = new Map<string, symbol>();
onAuthChange(() => { calls.clear(); targets.clear(); });

/** A retried tool identity observes its original outcome, never starts another dispatch. */
export function dispatchOnce(call: CommanderCall, target: string, current: () => boolean, work: () => Promise<Result>): Promise<Result> {
  const key = `${call.scope}:${call.id}`, prior = calls.get(key);
  if (!call.id || !current()) return Promise.reject(new Error('助理已停止或账号已变化，未派发'));
  if (prior) {
    if (prior.args !== call.arguments || !prior.current()) return Promise.reject(new Error('派发标识已失效或参数不一致，请核对目标会话'));
    return prior.result;
  }
  if (calls.size >= 128) for (const [id, row] of calls) { if (row.settled) calls.delete(id); }
  if (calls.size >= 128) return Promise.reject(new Error('待确认的派发过多，请稍后核对'));
  const result = exclusively(target, work);
  const row = { args: call.arguments, current, result, settled: false };
  calls.set(key, row);
  void result.then(() => { row.settled = true; }, () => { row.settled = true; });
  return result;
}
async function exclusively(target: string, work: () => Promise<Result>) {
  if (targets.has(target)) throw new Error('这个会话有一条派发正在确认，请先核对结果');
  const lease = Symbol(); targets.set(target, lease);
  try { return await work(); }
  finally { if (targets.get(target) === lease) targets.delete(target); }
}
