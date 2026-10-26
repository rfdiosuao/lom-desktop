import { beforeEach, expect, it, vi } from 'vitest';
import type { Conv } from '@/state/types';
const m = vi.hoisted(() => ({ rpc: vi.fn(), model: vi.fn(), cache: vi.fn(), error: vi.fn() }));
vi.mock('./phoneRpc', () => ({ phoneRpc: m.rpc }));
vi.mock('./phoneModel', () => ({ ensurePhoneModel: m.model, syncPhoneModel: vi.fn() }));
vi.mock('./phoneCache', () => ({ savePhoneCache: m.cache }));
vi.mock('@/shared/overlays/controller', () => ({ toast: vi.fn(), toastError: m.error }));
vi.mock('@/app/sound', () => ({ taskFinished: vi.fn() }));
import { sendPhone } from './phoneChat';
beforeEach(() => { vi.resetAllMocks(); m.model.mockResolvedValue(undefined); m.cache.mockResolvedValue(undefined); });

it('D26 stopping during phone model setup prevents chat.send and leaves no phantom pending request', async () => {
  const c: Conv = { id: 'phone-preflight', owner: 'dev_phone', title: 'Phone', updated: 1, messages: [] };
  let finish!: () => void, current = true;
  m.model.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const sending = sendPhone(c, 'work', [], () => current);
  current = false; finish();
  await expect(sending).rejects.toThrow('总指挥已停止');
  expect(m.rpc).not.toHaveBeenCalled(); expect(c.phonePending).toBeUndefined();
});

it('D26 stopping during the pre-send cache write clears the unsent pending record and never starts the phone', async () => {
  const c: Conv = { id: 'phone-cache-preflight', owner: 'dev_phone', title: 'Phone', updated: 1, messages: [] };
  let finish!: () => void, current = true;
  m.cache.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const sending = sendPhone(c, 'work', [], () => current);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  current = false; finish();
  await expect(sending).rejects.toThrow('总指挥已停止');
  expect(m.rpc).not.toHaveBeenCalled(); expect(c.phonePending).toBeUndefined();
});

it('PHONE-14 AC-6 a confirmed receipt remains successful if saving its local cache fails', async () => {
  const c: Conv = { id: 'phone-ack-cache', owner: 'dev_phone', title: 'Phone', updated: 1, messages: [] };
  m.rpc.mockImplementation(async (_device: string, method: string) => method === 'chat.send'
    ? { session_id: 'confirmed' }
    : { items: [], total: 0, next: 0, running: false, status: 'idle', error: '' });
  const failure = new Error('Disk full');
  m.cache.mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure);
  await expect(sendPhone(c, 'work')).resolves.toBeUndefined();
  expect(c.phoneSession).toBe('confirmed');
  expect(c.phonePending).toBeUndefined();
  expect(m.rpc.mock.calls.filter(call => call[1] === 'chat.send')).toHaveLength(1);
  expect(m.error).toHaveBeenCalledWith('消息已发送，但电脑本地记录保存失败', failure);
});

it('PHONE-14 AC-3 a pre-send cache failure never starts a phone task', async () => {
  const c: Conv = { id: 'phone-cache-failure', owner: 'dev_phone', title: 'Phone', updated: 1, messages: [] };
  m.cache.mockRejectedValueOnce(new Error('Disk full'));
  await expect(sendPhone(c, 'work')).rejects.toThrow('Disk full');
  expect(m.rpc).not.toHaveBeenCalled();
});
