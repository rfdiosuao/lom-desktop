import { authRevision } from '@/features/account/runtime/authScope';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';

/* ===== REFACTOR-01 模块 1（#280）：每个会话的操作记录 =====
 * 发送登记、结果未知的发送、停止、已完成轮次、成员派发代次和在途派发，原来分散在 cancel.ts 与
 * teams/runtime/delegationLifecycle.ts 的七个 Map / Set 里。现在只由这里持有；S.running 仍是界面投影。
 * 规则不变：已接收 ≠ 已完成；停止请求 ≠ 已停止；结果未知要对账，不自动重发；旧派发代次不能继续派发。 */

export interface Registration { turnIds: string[]; unknown: boolean; }

interface OperationRecord {
  /** 还没返回的发送请求 */
  sending: Set<Promise<unknown>>;
  /** 自上次全部确认以来，所有发送的登记结果（核心返回的轮次或「未知」） */
  registration?: Promise<Registration>;
  /** 登记结果未知的发送（本地消息 ID）；对账前不能当作失败重发 */
  unknown: Set<string | undefined>;
  /** 停止已发起、尚未全部确认 */
  stopping: boolean;
  /** 最近一次收到终态的轮次 */
  completed?: { turn: string; status?: string };
  /** 成员派发代次：停止时递增，旧代次的派发一律作废 */
  generation: number;
  /** 在途的成员派发；全部结束前停止不能算确认 */
  admissions: Set<Promise<boolean>>;
}

const records = new Map<string, OperationRecord>();
const record = (id: string): OperationRecord => {
  let row = records.get(id);
  if (!row) { row = { sending: new Set(), unknown: new Set(), stopping: false, generation: 0, admissions: new Set() }; records.set(id, row); }
  return row;
};

/* ---------- 发送登记 ---------- */

export const unknownRegistration = (): Registration => ({ turnIds: [], unknown: true });
export function registrationOf(value: unknown): Registration {
  if (!value || typeof value !== 'object') return unknownRegistration();
  const row = value as { turn_id?: unknown; turnIds?: unknown; unknown?: unknown };
  if (typeof row.turn_id === 'string' && row.turn_id) return { turnIds: [row.turn_id], unknown: false };
  if (Array.isArray(row.turnIds) && row.turnIds.every(id => typeof id === 'string') && typeof row.unknown === 'boolean')
    return { turnIds: row.turnIds, unknown: row.unknown };
  return unknownRegistration();
}
export const registrationResult = (pending: Promise<unknown>) => pending.then(registrationOf, unknownRegistration);

export const inFlight = (id: string) => !!records.get(id)?.sending.size;
export const registration = (id: string) => records.get(id)?.registration;
export const unconfirmed = (id: string) => { const row = records.get(id); return !!row?.registration && !!row.unknown.size; };

/** 登记一次发送；返回「这个会话是否还有其他在途发送」 */
export function trackSend(id: string, request: Promise<unknown>, classify: (value: unknown, error?: unknown) => Registration = value => registrationOf(value), messageId?: string) {
  const row = record(id);
  if (!row.registration) row.unknown.clear();
  row.sending.add(request);
  const finish = () => { row.sending.delete(request); };
  void request.then(finish, finish);
  const previous = row.registration;
  const own = request.then(value => classify(value), error => classify(undefined, error)).then(result => {
    if (result.unknown) row.unknown.add(messageId);
    return result;
  });
  const aggregate = Promise.all(previous ? [registrationResult(previous), own] : [own])
    .then(results => ({ turnIds: results.flatMap(r => r.turnIds), unknown: results.some(r => r.unknown) }));
  row.registration = aggregate;
  void aggregate.then(result => { if (!result.unknown && row.registration === aggregate) row.registration = undefined; });
  return () => [...row.sending].some(other => other !== request);
}

/** 空闲的运行状态本身不能证明结果未知的发送没有被接收：只有核心历史里看到了这些消息才算对账完成 */
export function reconcile(id: string, acceptedLocalIds: string[]) {
  const row = records.get(id);
  if (!row) return true;
  if (row.sending.size) return false;
  if (!row.unknown.size) return !row.registration;
  if (![...row.unknown].every(message => !!message && acceptedLocalIds.includes(message))) return false;
  row.unknown.clear(); row.registration = undefined;
  return true;
}

/* ---------- 终态 ---------- */

export const completeTurn = (id: string, turn: string, status?: string) => { record(id).completed = { turn, status }; };
export const completedStatus = (id: string, turn?: string) => {
  const done = records.get(id)?.completed;
  return turn && done?.turn === turn ? done.status : undefined;
};
export const isCompleted = (id: string, turn?: string) => !!turn && records.get(id)?.completed?.turn === turn;

/* ---------- 停止 ---------- */

/** 开始停止；已经在停止中返回 false */
export function beginStop(id: string) {
  const row = record(id);
  if (row.stopping) return false;
  row.stopping = true;
  return true;
}
export const endStop = (id: string) => { const row = records.get(id); if (row) row.stopping = false; };
export const isStopping = (id: string) => !!records.get(id)?.stopping;

/* ---------- 成员派发 ---------- */

/** 停止开始时同步调用，先于任何取消请求 */
export const invalidateDelegations = (parent: string) => { record(parent).generation++; };

/** 记下派发时的代次和账号；之后停止、换账号或会话被移除都会让它失效 */
export function captureDelegation(parent: Conv) {
  const expected = record(parent.id).generation, currentAccount = authRevision(), account = S.account?.id;
  return () => records.get(parent.id)?.generation === expected && currentAccount() && S.account?.id === account && S.convs.includes(parent);
}

/** 在途派发和迟到的清理全部结束前，停止都不能算确认 */
export function trackDelegation<T>(parent: string, work: Promise<T>): Promise<T> {
  const row = record(parent);
  const settled = work.then(() => true, () => false);
  row.admissions.add(settled);
  void settled.then(() => { row.admissions.delete(settled); });
  return work;
}
export async function settleDelegations(parent: string) {
  const results = await Promise.all([...(records.get(parent)?.admissions || [])]);
  return { stopped: 0, failed: results.filter(ok => !ok).length };
}

/** 清空全部操作记录；只用于测试隔离 */
export const resetOperations = () => { records.clear(); };

/* ---------- 对外视图 ---------- */

/** 新的一轮发送能否开始；不能时给出原因 */
export function sendBlocker(id: string): string | undefined {
  if (isStopping(id)) return '停止尚未确认，请等待后重试发送';
  if (unconfirmed(id)) return '上一条发送结果未确认，请重新打开任务核对记录后再发送';
  return undefined;
}

export interface OperationSnapshot {
  inFlight: boolean; unconfirmed: boolean; stopping: boolean;
  completed?: { turn: string; status?: string }; generation: number; pendingDelegations: number; blocker?: string;
}
/** 这个会话当前的操作记录，供诊断、个人助理会话工具和测试读取 */
export function operationSnapshot(id: string): OperationSnapshot {
  const row = records.get(id);
  return {
    inFlight: inFlight(id), unconfirmed: unconfirmed(id), stopping: isStopping(id), completed: row?.completed ? { ...row.completed } : undefined,
    generation: row?.generation ?? 0, pendingDelegations: row?.admissions.size ?? 0, blocker: sendBlocker(id),
  };
}
