import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { beginAuthChange } from '@/features/account/runtime/authScope';
import { S } from '@/state/store';
import type { Conv, Msg } from '@/state/types';

const m = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn() }));
vi.mock('@/features/phones/runtime/phoneChat', () => ({ refreshPhoneChat: m.refresh }));
vi.mock('@/features/chat/runtime/tasks', () => ({ sendFromChannel: m.send }));
import { observePersonalPhoneReceipt, registerPhoneReceipt, tickPersonalPhoneReceipts } from './phoneReceipt';
import { PHONE_START_TIMEOUT_MS } from './phoneTurn';

const T0 = 1_800_000_000_000;
const parent = { id: 'turn-parent', owner: 'pc', personal: { id: 'pa' }, messages: [] } as unknown as Conv;
let child: Conv;
const msg = (type: 'user' | 'assistant' | 'tool', at: number) => ({ id: `${type}${at}`, type, at, text: type }) as Msg;
const sent = () => m.send.mock.calls.map(c => c[1] as string);
const tick = async () => { await tickPersonalPhoneReceipts(); await tickPersonalPhoneReceipts(); };
/** 上一轮已经 completed，这一轮刚派出去：会话里只有旧消息，手机状态还是旧的 completed。 */
const dispatch = () => { registerPhoneReceipt(parent, child, T0); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T0 + 1000);
  beginAuthChange(); localStorage.clear(); m.refresh.mockReset(); m.send.mockReset().mockResolvedValue({ id: 'n' });
  S.cloud = 'signed-in'; S.conn = 'ready'; S.account = { id: 'turn-account', name: '', email: '' };
  S.agents = { dev_turn: { status: 'online' } } as unknown as typeof S.agents;
  child = { id: 'turn-child', owner: 'dev_turn', phoneSession: 's1', phoneRunStatus: 'completed', loaded: true,
    messages: [msg('user', T0 - 60_000), msg('assistant', T0 - 50_000)] } as unknown as Conv;
  S.convs = [parent, child]; S.running = {};
});
afterEach(() => vi.useRealTimers());

it('PHONE-RECEIPT-02 a completed state left over from the previous turn never becomes this turn\'s receipt', async () => {
  dispatch();
  await tick();
  expect(m.send).not.toHaveBeenCalled();
  vi.setSystemTime(T0 + 60_000); await tick(); // 还没到未启动的时限，仍然不报
  expect(m.send).not.toHaveBeenCalled();
});

it('PHONE-RECEIPT-02 the user row of this turn alone is not progress: stale completed still waits', async () => {
  dispatch();
  child.messages.push(msg('user', T0 + 500));
  await tick();
  expect(m.send).not.toHaveBeenCalled();
});

it('PHONE-RECEIPT-02 a real completion of this turn is reported once as completed', async () => {
  dispatch();
  child.messages.push(msg('user', T0 + 500), msg('tool', T0 + 2000), msg('assistant', T0 + 3000));
  await tick();
  expect(m.send).toHaveBeenCalledTimes(1);
  expect(sent()[0]).toContain('已结束，状态 completed');
  expect(sent()[0]).not.toContain('未启动');
});

it('PHONE-RECEIPT-02 running seen from the phone proves the turn started even when the rows are not synced yet', async () => {
  dispatch();
  S.running[child.id] = true; child.phoneRunStatus = 'running';
  observePersonalPhoneReceipt(child, { running: true });
  delete S.running[child.id]; child.phoneRunStatus = 'completed';
  await tick();
  expect(sent()).toHaveLength(1);
  expect(sent()[0]).toContain('completed');
});

it('PHONE-RECEIPT-02 a failure of this turn is reported as failed, not completed', async () => {
  dispatch();
  child.messages.push(msg('user', T0 + 500));
  child.phoneRunStatus = 'failed';
  await tick();
  expect(sent()).toHaveLength(1);
  expect(sent()[0]).toContain('未成功，状态 failed');
  expect(sent()[0]).not.toContain('已结束，状态 completed');
});

it('PHONE-RECEIPT-02 nothing started within the limit reports not_started after a real read, never completed', async () => {
  dispatch();
  m.refresh.mockResolvedValue(true);
  vi.setSystemTime(T0 + PHONE_START_TIMEOUT_MS + 1000);
  await tick();
  expect(m.refresh).toHaveBeenCalledWith(child); // 派发后会主动再读手机，而不是等盯会话的轮询
  expect(sent()).toHaveLength(1);
  expect(sent()[0]).toContain('未启动 not_started');
  expect(sent()[0]).not.toContain('状态 completed');
  await tick();
  expect(m.send).toHaveBeenCalledTimes(1);
});

it('PHONE-RECEIPT-02 a phone that could not be read reports unconfirmed, not not_started', async () => {
  dispatch();
  S.agents = { dev_turn: { status: 'offline' } } as unknown as typeof S.agents;
  vi.setSystemTime(T0 + PHONE_START_TIMEOUT_MS + 1000);
  await tick();
  expect(m.refresh).not.toHaveBeenCalled();
  expect(sent()).toHaveLength(1);
  expect(sent()[0]).toContain('无法确认 unconfirmed');
});

it('PHONE-RECEIPT-02 cancel before anything ran is not reported as completed; cancel after it ran is cancelled', async () => {
  dispatch();
  child.phoneRunStatus = 'cancelled';
  await tick();
  expect(m.send).not.toHaveBeenCalled(); // 没有本轮证据，等时限判定，不误报
  child.messages.push(msg('user', T0 + 500), msg('tool', T0 + 900));
  await tick();
  expect(sent()).toHaveLength(1);
  expect(sent()[0]).toContain('状态 cancelled');
});

it('PHONE-RECEIPT-02 a second dispatch gets its own window: the first turn\'s rows do not count for it', async () => {
  dispatch();
  child.messages.push(msg('user', T0 + 500), msg('assistant', T0 + 900));
  await tick();
  expect(sent()).toHaveLength(1);
  vi.setSystemTime(T0 + 10_000);
  registerPhoneReceipt(parent, child, T0 + 9_000); // 第二轮派发，但手机什么都没做
  await tick();
  expect(sent()).toHaveLength(1);
});
