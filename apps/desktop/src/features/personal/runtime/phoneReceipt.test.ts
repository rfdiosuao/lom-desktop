import { beforeEach, expect, it, vi } from 'vitest';
import { beginAuthChange } from '@/features/account/runtime/authScope';
import { S } from '@/state/store';
import type { Conv, Msg } from '@/state/types';

const m = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn() }));
vi.mock('@/features/phones/runtime/phoneChat', () => ({ refreshPhoneChat: m.refresh }));
vi.mock('@/features/chat/runtime/tasks', () => ({ sendFromChannel: m.send }));
import { registerPhoneReceipt, tickPersonalPhoneReceipts } from './phoneReceipt';

const parent = { id: 'receipt-parent', owner: 'pc', personal: { id: 'pa' }, messages: [] } as unknown as Conv;
const child = { id: 'receipt-child', owner: 'dev_receipt', phoneSession: 'actual-session', phoneRunStatus: 'accepted', messages: [] } as unknown as Conv;
/** 本轮确有回复：派发之后手机才出现的助理消息（PHONE-RECEIPT-02 之后，终态必须有本轮证据才算数）。 */
const reply = (): Msg[] => [{ id: 'reply', type: 'assistant', at: Date.now() + 1000, text: 'done' } as Msg];

beforeEach(() => {
  beginAuthChange(); localStorage.clear(); m.refresh.mockReset();
  S.cloud = 'signed-in'; S.conn = 'ready'; S.account = { id: 'receipt-account', name: '', email: '' };
  S.convs = [parent, child]; S.running = { [parent.id]: true, [child.id]: true };
  child.phoneRunStatus = 'accepted'; child.messages = []; m.send.mockReset().mockResolvedValue({ id: 'notification' });
});

it('PA-TEAM-01 delivers a terminal phone receipt once after the originating assistant is idle', async () => {
  registerPhoneReceipt(parent, child, Date.now());
  await tickPersonalPhoneReceipts();
  expect(m.send).not.toHaveBeenCalled();
  child.phoneRunStatus = 'completed'; child.messages = reply(); delete S.running[child.id];
  await tickPersonalPhoneReceipts();
  expect(m.send).not.toHaveBeenCalled();
  delete S.running[parent.id];
  await tickPersonalPhoneReceipts(); await tickPersonalPhoneReceipts();
  expect(m.send).toHaveBeenCalledTimes(1);
  expect(m.send.mock.calls[0]).toEqual([parent, expect.stringContaining('receipt-child'), 'phone_receipt', expect.any(Function)]);
});

it('PA-TEAM-01 drops phone receipts across account switches', async () => {
  registerPhoneReceipt(parent, child, Date.now());
  S.account = { id: 'other-account', name: '', email: '' };
  child.phoneRunStatus = 'completed'; S.running = {};
  await tickPersonalPhoneReceipts();
  expect(m.send).not.toHaveBeenCalled();
});


it('PA-TEAM-01 recovers an accepted phone task after restart, even if conversations load later', async () => {
  registerPhoneReceipt(parent, child, Date.now());
  beginAuthChange();
  S.convs = []; S.running = {};
  await tickPersonalPhoneReceipts();
  expect(m.send).not.toHaveBeenCalled();

  S.convs = [{ ...parent }, { ...child }];
  S.agents = { [child.owner]: { status: 'online' } } as typeof S.agents;
  m.refresh.mockImplementation(async (restored: Conv) => { restored.phoneRunStatus = 'completed'; restored.messages = reply(); });
  await tickPersonalPhoneReceipts();
  expect(m.refresh).toHaveBeenCalledWith(S.convs[1]);
  expect(m.send).toHaveBeenCalledTimes(1);

  beginAuthChange();
  await tickPersonalPhoneReceipts();
  expect(m.send).toHaveBeenCalledTimes(1);
});

it('PA-TEAM-01 retains a confirmed completion while the assistant is busy and recovers it with the phone offline', async () => {
  registerPhoneReceipt(parent, child, Date.now());
  child.phoneRunStatus = 'completed'; child.messages = reply(); delete S.running[child.id];
  await tickPersonalPhoneReceipts();
  expect(m.send).not.toHaveBeenCalled();

  beginAuthChange();
  S.convs = [{ ...parent }, { ...child, phoneRunStatus: 'unknown', messages: reply() }]; S.running = {};
  await tickPersonalPhoneReceipts();
  expect(m.refresh).not.toHaveBeenCalled();
  expect(m.send).toHaveBeenCalledTimes(1);
});

it('PA-TEAM-01 leaves the receipt pending if the restored conversation points to another phone session', async () => {
  registerPhoneReceipt(parent, child, Date.now());
  beginAuthChange();
  S.convs = [{ ...parent }, { ...child, phoneSession: 'other-session', phoneRunStatus: 'completed' }]; S.running = {};
  await tickPersonalPhoneReceipts();
  expect(m.refresh).not.toHaveBeenCalled();
  expect(m.send).not.toHaveBeenCalled();
});
