import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';
const m = vi.hoisted(() => ({ api: vi.fn(), phones: vi.fn(), agents: vi.fn(), toast: vi.fn(), error: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api }));
vi.mock('@/features/phones/runtime/phoneCommander', () => ({ stopDelegated: m.phones }));
vi.mock('@/features/phones/runtime/commanderAgents', () => ({ stopAgentDelegated: m.agents }));
vi.mock('@/shared/overlays/controller', () => ({ toast: m.toast, toastError: m.error }));
const { stopTask, pendingSends, isTaskStopping, reconcileSendRegistrations } = await import('./cancel');
const { sendToTask } = await import('./tasks');
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const idle = { runtime: { is_processing: false, turn_id: null } };
const active = (turn: string) => ({ runtime: { is_processing: true, turn_id: turn } });
let c: Conv;
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); pendingSends.clear();
  c = { id: 'stop', owner: 'pc', title: 'Task', updated: 0, remote: true, turnId: 'stale', messages: [] };
  S.convs = [c]; S.running = { stop: true }; S.teams = [];
  S.account = { id: 'review', email: 'review@example.test', name: 'Review' };
  m.phones.mockResolvedValue({ stopped: 0, failed: 0 }); m.agents.mockResolvedValue({ stopped: 0, failed: 0 }); m.api.mockResolvedValue(idle);
});
afterEach(() => { vi.useRealTimers(); });
it('D01 AC-5 cancels the current server turn before pending POST responds, then reconciles late registration', async () => {
  const sent = deferred<unknown>();
  const phone = deferred<{ stopped: number; failed: number }>(); m.phones.mockReturnValue(phone.promise);
  c.agentId = 'external'; delete S.running[c.id];
  m.api.mockImplementation((method: string, path: string) => path.endsWith('/messages') ? sent.promise : Promise.resolve(method === 'GET' ? active('current') : idle));
  const sending = sendToTask(c, 'Please work', []); await vi.advanceTimersByTimeAsync(0);
  expect(pendingSends.has(c.id)).toBe(true);
  const stopped = stopTask(c.id); await vi.advanceTimersByTimeAsync(0);
  expect(m.api).toHaveBeenCalledWith('POST', '/api/conversations/stop/cancel', { turn_id: 'current' }, expect.anything());
  expect(m.phones).toHaveBeenCalledWith(c.id); expect(m.agents).toHaveBeenCalledWith(c.id);
  await vi.advanceTimersByTimeAsync(15000);
  expect(await stopped).toBe(false); expect(S.running.stop).toBe(true); expect(isTaskStopping(c.id)).toBe(true);
  expect(c.messages.some(x => x.text === '已停止。')).toBe(false);
  const count = c.messages.length; expect(await sendToTask(c, 'New turn', [])).toBe(false); expect(c.messages).toHaveLength(count);
  S.account = { ...S.account!, name: 'Refreshed account' };
  m.api.mockImplementation(async (method: string) => method === 'GET' ? active('late') : idle);
  sent.resolve({ turn_id: 'late' }); expect(await sending).toBe(true); await vi.advanceTimersByTimeAsync(0);
  expect(m.api).toHaveBeenCalledWith('POST', '/api/conversations/stop/cancel', { turn_id: 'late' }, expect.anything());
  expect(S.running.stop).toBeUndefined(); expect(c.turnId).toBeUndefined(); expect(isTaskStopping(c.id)).toBe(true);
  phone.resolve({ stopped: 0, failed: 0 }); await vi.advanceTimersByTimeAsync(0); expect(isTaskStopping(c.id)).toBe(false);
});
it('D01 AC-5 a failed pending send cannot clear running while cancellation remains unconfirmed', async () => {
  const sent = deferred<unknown>(), cancelled = deferred<unknown>(); c.agentId = 'external'; delete S.running[c.id];
  m.api.mockImplementation((method: string, path: string) => path.endsWith('/messages') ? sent.promise : method === 'GET' ? Promise.resolve(active('current')) : cancelled.promise);
  const sending = sendToTask(c, 'Please work', []); await vi.advanceTimersByTimeAsync(0);
  const stopped = stopTask(c.id); await vi.advanceTimersByTimeAsync(0);
  sent.reject(new Error('Response lost')); expect(await sending).toBe(false); await vi.advanceTimersByTimeAsync(0); expect(S.running.stop).toBe(true);
  cancelled.resolve(idle); await vi.advanceTimersByTimeAsync(0); expect(await stopped).toBe(false); expect(S.running.stop).toBe(true);
});
it.each(['rejected', 'no-id'])('D26 settled %s transport debt survives until exact accepted-message reconciliation', async outcome => {
  c.agentId = 'external'; delete S.running[c.id];
  m.api.mockImplementation(async (_method: string, path: string) => {
    if (!path.endsWith('/messages')) return idle;
    if (outcome === 'rejected') throw new Error('Response lost');
    return {};
  });
  expect(await sendToTask(c, 'Uncertain message', [])).toBe(false); await vi.advanceTimersByTimeAsync(0);
  const message = c.messages.find(item => item.type === 'user')!;
  expect(message.status).toBe('unconfirmed'); expect(pendingSends.has(c.id)).toBe(true);
  m.api.mockClear(); const stopped = stopTask(c.id); await vi.advanceTimersByTimeAsync(250);
  expect(await stopped).toBe(false); expect(S.running.stop).toBe(true); expect(pendingSends.has(c.id)).toBe(true);
  expect(m.api.mock.calls.filter(call => call[0] === 'POST')).toEqual([]); expect(c.messages.some(item => item.text === '已停止。')).toBe(false);
  expect(reconcileSendRegistrations(c.id, [])).toBe(false);
  expect(reconcileSendRegistrations(c.id, [message.id])).toBe(true); expect(pendingSends.has(c.id)).toBe(false);
});
it.each(['preflight', 'core-rejection'])('D26 %s failure is a known non-admission and remains safely retryable', async outcome => {
  c.agentId = 'external'; delete S.running[c.id];
  m.api.mockImplementation(async (_method: string, path: string) => { if (path.endsWith('/messages')) throw Object.assign(new Error('Rejected'), { status: 400 }); return idle; });
  expect(await sendToTask(c, 'Known rejected message', [], outcome === 'preflight' ? () => false : undefined)).toBe(false);
  await vi.advanceTimersByTimeAsync(0); expect(pendingSends.has(c.id)).toBe(false);
  expect(c.messages.find(item => item.type === 'user')?.status).toBe('error'); expect(await stopTask(c.id)).toBe(true);
});
it.each(['accepted', 'failed'])('D01 AC-5 older %s send cannot erase another pending registration before stopping', async outcome => {
  const first = deferred<unknown>(), second = deferred<unknown>(); c.agentId = 'external'; delete S.running[c.id]; let posts = 0;
  m.api.mockImplementation((method: string, path: string) => path.endsWith('/messages') ? (++posts === 1 ? first.promise : second.promise) : Promise.resolve(method === 'GET' ? active('first') : idle));
  const one = sendToTask(c, 'First message', []), two = sendToTask(c, 'Second message', []); await vi.advanceTimersByTimeAsync(0);
  if (outcome === 'accepted') first.resolve({ turn_id: 'first' }); else first.reject(new Error('First response lost'));
  expect(await one).toBe(outcome === 'accepted'); expect(pendingSends.has(c.id)).toBe(true); expect(S.running.stop).toBe(true);
  const stopped = stopTask(c.id); await vi.advanceTimersByTimeAsync(15000);
  expect(await stopped).toBe(false); expect(isTaskStopping(c.id)).toBe(true); expect(S.running.stop).toBe(true);
  m.api.mockImplementation(async (method: string) => method === 'GET' ? active('second') : idle);
  second.resolve({ turn_id: 'second' }); expect(await two).toBe(true); await vi.advanceTimersByTimeAsync(0);
  expect(pendingSends.has(c.id)).toBe(outcome === 'failed'); expect(S.running.stop).toBe(outcome === 'accepted' ? undefined : true); expect(isTaskStopping(c.id)).toBe(false);
  expect(m.api).toHaveBeenCalledWith('POST', '/api/conversations/stop/cancel', { turn_id: 'second' }, expect.anything());
});
it.each(['ours', 'no-id', 'rejected'])('D01 AC-5 late %s registration cannot cancel a newer unrelated client turn', async outcome => {
  const sent = deferred<unknown>(); c.agentId = 'external'; delete S.running[c.id];
  m.api.mockImplementation((method: string, path: string) => path.endsWith('/messages') ? sent.promise : Promise.resolve(method === 'GET' ? active('ours') : idle));
  const sending = sendToTask(c, 'Our message', []); await vi.advanceTimersByTimeAsync(0);
  const stopped = stopTask(c.id); await vi.advanceTimersByTimeAsync(15000); expect(await stopped).toBe(false);
  m.api.mockClear(); m.api.mockImplementation(async (method: string) => method === 'GET' ? active('other-client') : idle);
  if (outcome === 'rejected') sent.reject(new Error('Response lost')); else sent.resolve(outcome === 'ours' ? { turn_id: 'ours' } : {});
  await sending; await vi.advanceTimersByTimeAsync(0);
  expect(m.api.mock.calls.filter(call => call[0] === 'POST')).toEqual([]); expect(S.running.stop).toBe(true); expect(isTaskStopping(c.id)).toBe(false);
});
it.each(['ours', 'no-id', 'rejected'])('D26 idle runtime followed by foreign turn never cancels it during %s registration', async outcome => {
  const sent = deferred<unknown>(); c.agentId = 'external'; delete S.running[c.id];
  m.api.mockImplementation((_method: string, path: string) => path.endsWith('/messages') ? sent.promise : Promise.resolve(idle));
  const sending = sendToTask(c, 'Our pending message', []); await vi.advanceTimersByTimeAsync(0);
  const stopped = stopTask(c.id); await vi.advanceTimersByTimeAsync(0);
  m.api.mockClear(); m.api.mockImplementation(async (method: string) => method === 'GET' ? active('foreign') : idle);
  await vi.advanceTimersByTimeAsync(250); expect(m.api.mock.calls.filter(call => call[0] === 'POST')).toEqual([]);
  if (outcome === 'rejected') sent.reject(new Error('Response lost')); else sent.resolve(outcome === 'ours' ? { turn_id: 'ours' } : {});
  await sending; await vi.advanceTimersByTimeAsync(250);
  expect(await stopped).toBe(false); expect(m.api.mock.calls.filter(call => call[0] === 'POST')).toEqual([]); expect(S.running.stop).toBe(true);
});
it.each(['runtime', 'cancel'])('D01 AC-5 hung %s request is bounded, aborted, and cannot later report stopped', async kind => {
  const held = deferred<unknown>(); m.api.mockImplementation((method: string) => kind === 'runtime' || method === 'POST' ? held.promise : Promise.resolve(active('current')));
  const stopped = stopTask(c.id); await vi.advanceTimersByTimeAsync(15000);
  expect(await stopped).toBe(false); expect(S.running.stop).toBe(true);
  const request = m.api.mock.calls.find(x => kind === 'runtime' || x[0] === 'POST')!; expect(request[3].signal.aborted).toBe(true);
  expect(m.phones).toHaveBeenCalledOnce(); expect(m.agents).toHaveBeenCalledOnce();
  held.resolve(idle); await vi.advanceTimersByTimeAsync(0);
  expect(S.running.stop).toBe(true); expect(c.messages.some(x => x.text === '已停止。')).toBe(false); expect(isTaskStopping(c.id)).toBe(false);
});
it('D13 stalled phone cancellation retains the guard after returning unconfirmed', async () => {
  const phone = deferred<{ stopped: number; failed: number }>(); m.phones.mockReturnValue(phone.promise);
  const stopped = stopTask(c.id); await vi.advanceTimersByTimeAsync(15000);
  expect(await stopped).toBe(false); expect(isTaskStopping(c.id)).toBe(true); expect(await stopTask(c.id)).toBe(false); expect(m.phones).toHaveBeenCalledOnce();
  phone.resolve({ stopped: 1, failed: 0 }); await vi.advanceTimersByTimeAsync(0);
  expect(isTaskStopping(c.id)).toBe(false); expect(m.toast.mock.calls.some(x => String(x[0]).startsWith('已停止，并确认'))).toBe(false);
});
it('D01 AC-5 idle runtime while send is pending is not proof of stopping', async () => {
  const sent = deferred<unknown>(); pendingSends.set(c.id, sent.promise); const stopped = stopTask(c.id); await vi.advanceTimersByTimeAsync(0);
  expect(S.running.stop).toBe(true); expect(c.messages).toEqual([]);
  m.api.mockImplementation(async (method: string) => method === 'GET' ? active('registered') : idle);
  pendingSends.delete(c.id); sent.resolve({ turn_id: 'registered' }); await vi.advanceTimersByTimeAsync(250);
  expect(await stopped).toBe(true); expect(S.running.stop).toBeUndefined();
  expect(m.api).toHaveBeenCalledWith('POST', '/api/conversations/stop/cancel', { turn_id: 'registered' }, expect.anything());
});
it('D01 AC-5 changed turn after cancellation is not cancelled with the previous turn id', async () => {
  m.api.mockResolvedValueOnce(active('current')).mockResolvedValueOnce(active('current')).mockResolvedValueOnce(active('new'));
  const stopped = stopTask(c.id); await vi.advanceTimersByTimeAsync(250);
  expect(await stopped).toBe(false); expect(S.running.stop).toBe(true); expect(m.api.mock.calls.filter(x => x[0] === 'POST')).toHaveLength(1);
});
