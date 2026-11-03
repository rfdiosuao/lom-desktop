import { beforeEach, expect, it } from 'vitest';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';
import {
  beginStop, captureDelegation, completeTurn, completedStatus, endStop, invalidateDelegations, isCompleted, operationSnapshot,
  reconcile, registration, resetOperations, sendBlocker, settleDelegations, trackDelegation, trackSend,
} from './turnLedger';

const deferred = <T>() => { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const unknownOnFailure = (value: unknown, error?: unknown) => (error ? { turnIds: [], unknown: true } : { turnIds: [(value as { turn_id: string }).turn_id], unknown: false });
beforeEach(() => { resetOperations(); });

it('REFACTOR-01-M1 AC-1 已接收不等于已完成：拿到轮次后仍要等终态', async () => {
  const sent = deferred<unknown>();
  trackSend('c', sent.promise, undefined, 'm1');
  expect(operationSnapshot('c')).toMatchObject({ inFlight: true, unconfirmed: false, completed: undefined });
  sent.resolve({ turn_id: 't1' }); await tick();
  expect(operationSnapshot('c')).toMatchObject({ inFlight: false, unconfirmed: false, completed: undefined });
  expect(isCompleted('c', 't1')).toBe(false);
  completeTurn('c', 't1', 'finished');
  expect(completedStatus('c', 't1')).toBe('finished');
});

it('REFACTOR-01-M1 AC-2 停止请求不等于已停止：确认前阻止新发送，重复停止不另起流程', () => {
  expect(beginStop('c')).toBe(true);
  expect(beginStop('c')).toBe(false);
  expect(sendBlocker('c')).toBe('停止尚未确认，请等待后重试发送');
  endStop('c');
  expect(sendBlocker('c')).toBeUndefined();
});

it('REFACTOR-01-M1 AC-3 结果未知的发送要对账，不能当作失败重发', async () => {
  const sent = deferred<unknown>();
  trackSend('c', sent.promise, unknownOnFailure, 'm1');
  sent.reject(new Error('network')); await tick();
  expect(operationSnapshot('c')).toMatchObject({ inFlight: false, unconfirmed: true, blocker: '上一条发送结果未确认，请重新打开任务核对记录后再发送' });
  expect(reconcile('c', [])).toBe(false); // 运行空闲不是证据
  expect(reconcile('c', ['other'])).toBe(false);
  expect(reconcile('c', ['m1'])).toBe(true); // 核心历史里看到了这条消息
  expect(registration('c')).toBeUndefined();
  expect(sendBlocker('c')).toBeUndefined();
});

it('REFACTOR-01-M1 AC-3 在途发送期间不能对账；多次发送的登记结果合并', async () => {
  const first = deferred<unknown>(), second = deferred<unknown>();
  trackSend('c', first.promise, unknownOnFailure, 'm1');
  const others = trackSend('c', second.promise, unknownOnFailure, 'm2');
  expect(others()).toBe(true);
  expect(reconcile('c', ['m1', 'm2'])).toBe(false);
  first.resolve({ turn_id: 't1' }); second.resolve({ turn_id: 't2' }); await tick();
  expect(await registration('c')).toBeUndefined();
  expect(operationSnapshot('c').unconfirmed).toBe(false);
});

it('REFACTOR-01-M1 AC-4 旧回执不能覆盖新任务：旧轮次查不到终态，旧派发代次失效', () => {
  completeTurn('c', 'old', 'finished');
  completeTurn('c', 'new', 'cancelled');
  expect(completedStatus('c', 'old')).toBeUndefined();
  expect(completedStatus('c', 'new')).toBe('cancelled');
  const parent = { id: 'p', owner: 'pc', title: '', updated: 0, messages: [] } as Conv;
  S.convs = [parent]; S.account = { id: 'owner', name: '', email: '' };
  const current = captureDelegation(parent);
  expect(current()).toBe(true);
  invalidateDelegations('p');
  expect(current()).toBe(false);
  expect(captureDelegation(parent)()).toBe(true); // 新代次可以派发
});

it('REFACTOR-01-M1 AC-5 父任务停止要等在途派发都有回执，失败的计入未确认', async () => {
  const ok = deferred<void>(), failed = deferred<void>();
  void trackDelegation('p', ok.promise); void trackDelegation('p', failed.promise).catch(() => undefined);
  expect(operationSnapshot('p').pendingDelegations).toBe(2);
  let settled = false;
  const result = settleDelegations('p').then(r => { settled = true; return r; });
  await tick(); expect(settled).toBe(false);
  ok.resolve(); failed.reject(new Error('lost'));
  expect(await result).toEqual({ stopped: 0, failed: 1 });
  await tick(); expect(operationSnapshot('p').pendingDelegations).toBe(0);
});
