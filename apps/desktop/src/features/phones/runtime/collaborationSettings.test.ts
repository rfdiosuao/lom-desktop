import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ rpc: vi.fn(), send: vi.fn(), toast: vi.fn() }));
vi.mock('./phoneRpc', () => ({ phoneRpc: m.rpc }));
vi.mock('@/features/chat/runtime/tasks', () => ({ sendToTask: m.send }));
vi.mock('@/shared/overlays/controller', () => ({ toast: m.toast }));
import { S } from '@/state/store';
import { initialState } from '@/state/state';
import { monitorDelegated, tickSupervision, stopMonitoring } from './collaborationSettings';
let n = 0;
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); Object.assign(S, initialState());
  S.account = { id: `account-${++n}` } as typeof S.account; S.cloud = 'signed-in'; S.conn = 'ready'; S.prefs.supervise = 1;
  S.agents.dev_a = { ...S.agents.p1, id: 'dev_a', real: true, status: 'online' };
  S.convs = [{ id: 'parent', owner: 'pc', remote: true, title: '', updated: 0, messages: [] }]; S.convPhones.parent = ['dev_a']; S.prefs.autoTakeover = true;
  m.send.mockResolvedValue(true);
});
it('reads status at the selected interval, never calls a model for a running task', async () => {
  monitorDelegated('parent', 'dev_a', 'session'); m.rpc.mockResolvedValue({ running: true, status: 'running' });
  await tickSupervision(Date.now() + 1000); expect(m.rpc).not.toHaveBeenCalled();
  await tickSupervision(Date.now() + 61000); expect(m.rpc).toHaveBeenCalledTimes(1); expect(m.send).not.toHaveBeenCalled();
});
it('never takes over unknown, timed-out or interrupted work', async () => {
  monitorDelegated('parent', 'dev_a', 'session'); m.rpc.mockRejectedValueOnce(new Error('offline'));
  await tickSupervision(Date.now() + 61000); expect(m.send).not.toHaveBeenCalled();
  m.rpc.mockResolvedValue({ running: false, status: 'timeout' }); await tickSupervision(Date.now() + 130000);
  expect(m.toast).toHaveBeenCalledTimes(1); expect(m.send).not.toHaveBeenCalled();
});
it('explicit failure can trigger assistance once, after checking parent scope and idle state', async () => {
  monitorDelegated('parent', 'dev_a', 'session'); m.rpc.mockResolvedValue({ running: false, status: 'failed' });
  await tickSupervision(Date.now() + 61000); await tickSupervision(Date.now() + 130000);
  expect(m.send).toHaveBeenCalledTimes(1); expect(m.send.mock.calls[0][1]).toContain('不得盲目重跑');
});
it('off disables assistance and notifications; stop cancels the monitor', async () => {
  monitorDelegated('parent', 'dev_a', 'session'); S.prefs.autoTakeover = false; S.prefs.notifyHelp = false;
  m.rpc.mockResolvedValue({ running: false, status: 'failed' }); await tickSupervision(Date.now() + 61000);
  expect(m.send).not.toHaveBeenCalled(); expect(m.toast).not.toHaveBeenCalled();
  monitorDelegated('parent', 'dev_a', 'other'); stopMonitoring('parent'); m.rpc.mockClear(); await tickSupervision(Date.now() + 130000); expect(m.rpc).not.toHaveBeenCalled();
});
it('changing accounts while the reply is pending cannot launch or notify in the new account', async () => {
  monitorDelegated('parent', 'dev_a', 'session'); let resolve!: (x: unknown) => void;
  m.rpc.mockImplementation(() => new Promise(r => { resolve = r; })); const pending = tickSupervision(Date.now() + 61000);
  S.account = { id: 'switched' } as typeof S.account; resolve({ running: false, status: 'failed' }); await pending;
  expect(m.send).not.toHaveBeenCalled(); expect(m.toast).not.toHaveBeenCalled();
});
it('cannot launch assistance when its no-replay checkpoint cannot be persisted', async () => {
  monitorDelegated('parent', 'dev_a', 'session'); m.rpc.mockResolvedValue({ running: false, status: 'failed' });
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
  try { await tickSupervision(Date.now() + 61000); expect(m.send).not.toHaveBeenCalled(); }
  finally { storage.mockRestore(); }
});
