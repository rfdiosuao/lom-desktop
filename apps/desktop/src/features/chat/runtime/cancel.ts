import { toast, toastError } from '@/shared/overlays/controller';
import { conv } from '@/state/selectors';
import { S, update } from '@/state/store';
import { uid } from '@/shared/lib/util';
import { api } from '@/core/client';
import { stopDelegated } from '@/features/phones/runtime/phoneCommander';
import { stopAgentDelegated } from '@/features/phones/runtime/commanderAgents';
import { stopAttempt } from './stopAttempt';
import { authRevision } from '@/features/account/runtime/authScope';
import { invalidateDelegations, stopDelegationAdmissions } from '@/features/teams/runtime/delegationLifecycle';

export interface Registration { turnIds: string[]; unknown: boolean; }
const unknownRegistration = (): Registration => ({ turnIds: [], unknown: true });
function registrationOf(value: unknown): Registration {
  if (!value || typeof value !== 'object') return unknownRegistration();
  const row = value as { turn_id?: unknown; turnIds?: unknown; unknown?: unknown };
  if (typeof row.turn_id === 'string' && row.turn_id) return { turnIds: [row.turn_id], unknown: false };
  if (Array.isArray(row.turnIds) && row.turnIds.every(id => typeof id === 'string') && typeof row.unknown === 'boolean')
    return { turnIds: row.turnIds, unknown: row.unknown };
  return unknownRegistration();
}
const registrationResult = (pending: Promise<unknown>) => pending.then(registrationOf, unknownRegistration);

/** A pending send can still register a turn after an idle runtime response. */
export const pendingSends = new Map<string, Promise<unknown>>();
const sending = new Map<string, Set<Promise<unknown>>>();
const uncertain = new Map<string, Set<string | undefined>>();
export const hasInFlightSend = (id: string) => !!sending.get(id)?.size;
export const hasUnconfirmedSend = (id: string) => pendingSends.has(id) && !!uncertain.get(id)?.size;

/** Idle runtime alone cannot prove that an unknown send was never admitted. */
export function reconcileSendRegistrations(id: string, acceptedLocalIds: string[], _turnId?: string) {
  if (hasInFlightSend(id)) return false;
  const debt = uncertain.get(id);
  if (!debt) return !pendingSends.has(id);
  if (![...debt].every(message => !!message && acceptedLocalIds.includes(message))) return false;
  uncertain.delete(id); pendingSends.delete(id);
  return true;
}

export function trackPendingSend(id: string, request: Promise<unknown>, classify = (value: unknown, _error?: unknown) => registrationOf(value), messageId?: string) {
  if (!pendingSends.has(id)) uncertain.delete(id);
  const requests = sending.get(id) || new Set<Promise<unknown>>();
  requests.add(request); sending.set(id, requests);
  const finish = () => { requests.delete(request); if (!requests.size) sending.delete(id); };
  void request.then(finish, finish);
  const previous = pendingSends.get(id);
  const own = request.then(value => classify(value), error => classify(undefined, error)).then(result => {
    if (result.unknown) { const debt = uncertain.get(id) || new Set(); debt.add(messageId); uncertain.set(id, debt); }
    return result;
  });
  const aggregate = Promise.all(previous ? [registrationResult(previous), own] : [own])
    .then(results => ({ turnIds: results.flatMap(r => r.turnIds), unknown: results.some(r => r.unknown) }));
  pendingSends.set(id, aggregate);
  void aggregate.then(result => { if (!result.unknown && pendingSends.get(id) === aggregate) pendingSends.delete(id); });
  return () => [...requests].some(other => other !== request);
}
const stopping = new Set<string>();
const completedTurns = new Map<string, string>();
export const recordCompletedTurn = (id: string, turnId: string) => { completedTurns.set(id, turnId); };
export const isCompletedTurn = (id: string, turnId?: string) => !!turnId && completedTurns.get(id) === turnId;
export const isTaskStopping = (id: string) => stopping.has(id);
interface Runtime { is_processing: boolean; turn_id: string | null; }
interface Snapshot { runtime: Runtime; }

function markStopped(id: string, wasRunning: boolean) {
  update(s => {
    delete s.running[id];
    const c = conv(id);
    if (!c) return;
    c.turnId = undefined;
    c.messages.forEach(m => {
      if (m.streaming) m.streaming = false;
      if (m.status === 'running') m.status = 'error';
      if (['approval', 'question'].includes(m.type) && ['pending', 'submitting'].includes(m.status || '')) m.status = 'denied';
    });
    if (wasRunning) c.messages.push({ id: uid('m'), type: 'system', at: Date.now(), text: '已停止。', ic: 'stop' });
  });
}

async function cancelOwn(id: string, quiet = false, expected?: Registration): Promise<boolean> {
  const attempt = stopAttempt();
  const pending = pendingSends.get(id);
  const original = conv(id), account = S.account?.id, auth = authRevision();
  const current = () => conv(id) === original && S.account?.id === account && auth();
  let registration = expected;
  let registered = !pending, wasRunning = !!S.running[id], cancelled = '', awaitingRegistration = false;
  // Sending errors are handled by the sender; they still require an authoritative runtime check.
  if (pending) void registrationResult(pending).then(result => { registered = true; registration = result; });
  const snapshot = () => attempt.wait(api<Snapshot>('GET', `/api/conversations/${id}`, undefined, { signal: attempt.signal }));
  try {
    while (true) {
      let { runtime } = await snapshot();
      if (!current()) throw new Error('会话或账号已切换，未继续停止旧任务');
      if (!runtime) throw new Error('无法确认当前运行状态，请重试');
      awaitingRegistration ||= !runtime.is_processing && !registered;
      wasRunning ||= runtime.is_processing;
      if (runtime.is_processing && runtime.turn_id !== cancelled) {
        if (!runtime.turn_id) throw new Error('任务正在启动，请稍后重试停止');
        if (cancelled || expected || awaitingRegistration) {
          if (!registered) { await attempt.wait(new Promise(resolve => setTimeout(resolve, 250))); continue; }
          if (!registration?.turnIds.includes(runtime.turn_id)) throw new Error('任务已切换到其他轮次，未取消新任务；请重新查看会话');
        }
        // Never use the cached turnId; this snapshot may include a just-registered send.
        cancelled = runtime.turn_id;
        const result = await attempt.wait(api<Snapshot>('POST', `/api/conversations/${id}/cancel`, { turn_id: cancelled }, { signal: attempt.signal }));
        if (!current()) throw new Error('会话或账号已切换，未更新旧任务状态');
        runtime = result?.runtime;
        if (!quiet) toast('正在停止…', 'stop');
      }
      if (runtime && !runtime.is_processing && registered) {
        if (registration?.unknown) throw new Error('发送登记结果尚未确认，不能确认任务已停止；请查看会话后重试');
        break;
      }
      await attempt.wait(new Promise(resolve => setTimeout(resolve, 250)));
    }
    markStopped(id, wasRunning);
    return wasRunning;
  } finally { attempt.finish(); }
}

/** Keep the guard until every underlying operation that can still mutate state has settled. */
function guard(id: string, work: Promise<unknown>, own: Promise<boolean>) {
  const pending = pendingSends.get(id), original = conv(id), account = S.account?.id, auth = authRevision();
  const reconcile = own.then(async stopped => {
    try {
      if (!stopped && pending) {
        const registration = await registrationResult(pending);
        if (conv(id) === original && S.account?.id === account && auth()) await cancelOwn(id, true, registration);
      }
    } catch (e) { console.warn('task.late_stop_unconfirmed', id, e instanceof Error ? e.message : e); }
  });
  void Promise.allSettled([work, reconcile]).then(() => update(() => { stopping.delete(id); }));
}

async function stopMembers(work: Promise<{ stopped: number; failed: number }>) {
  try { return await work; }
  catch (e) { console.warn('team.members_stop_unconfirmed', e instanceof Error ? e.message : e); return { stopped: 0, failed: 1 }; }
}

/** Member cancellation never cascades into other members. */
export async function stopChildTask(id: string): Promise<{ ok: boolean; ran: boolean }> {
  if (stopping.has(id)) return { ok: false, ran: true };
  invalidateDelegations(id);
  stopping.add(id);
  const own = cancelOwn(id, true).then(ran => ({ ok: true, ran }), e => {
    console.warn('team.child_stop_unconfirmed', id, e instanceof Error ? e.message : e);
    return { ok: false, ran: true };
  });
  const work = Promise.all([own, stopMembers(stopDelegationAdmissions(id))])
    .then(([result, admissions]) => ({ ...result, ok: result.ok && admissions.failed === 0 }));
  guard(id, work, own.then(result => result.ok));
  const attempt = stopAttempt();
  try { return await attempt.wait(work); }
  catch (e) { console.warn('team.child_stop_unconfirmed', id, e instanceof Error ? e.message : e); return { ok: false, ran: true }; }
  finally { attempt.finish(); }
}

export async function stopTask(id: string): Promise<boolean> {
  if (stopping.has(id)) return false;
  invalidateDelegations(id);
  stopping.add(id);
  update(st => { const g = st.goals[`conv:${id}`]; if (g && !g.done && !g.paused) { g.paused = true; g.pausedAt = Date.now(); g.note = '已停止，目标暂停'; } });
  const own = cancelOwn(id).then(() => true, e => { toastError('本会话停止尚未确认', e); return false; });
  // A stalled parent request must not delay either kind of delegated cancellation.
  const work = Promise.all([own, stopMembers(stopDelegated(id)), stopMembers(stopAgentDelegated(id)), stopMembers(stopDelegationAdmissions(id))]);
  guard(id, work, own);
  const attempt = stopAttempt();
  try {
    const [ownStopped, phones, agents, admissions] = await attempt.wait(work);
    const stopped = phones.stopped + agents.stopped + admissions.stopped;
    const failed = phones.failed + agents.failed + admissions.failed + (ownStopped ? 0 : 1);
    if (failed) toast(`${failed} 个任务尚未确认停止；已确认 ${stopped} 个成员任务停止。可以重试或打开成员会话检查`, 'info');
    else toast(stopped ? `已停止，并确认 ${stopped} 个成员任务停止` : '已停止', 'stop');
    return failed === 0;
  } catch (e) { toastError('停止尚未确认', e); return false; }
  finally { attempt.finish(); }
}
