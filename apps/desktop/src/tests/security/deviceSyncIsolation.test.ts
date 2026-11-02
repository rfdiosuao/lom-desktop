import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/features/phones/runtime/phoneRpc', () => ({ phoneRpc: m.rpc }));
let S: typeof import('@/state/store')['S'];
let auth: typeof import('@/features/account/runtime/authScope');
let status: typeof import('@/features/phones/runtime/deviceStatus');
let names: typeof import('@/features/phones/runtime/deviceName');
const defer = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear();
  ({ S } = await import('@/state/store')); auth = await import('@/features/account/runtime/authScope');
  status = await import('@/features/phones/runtime/deviceStatus'); names = await import('@/features/phones/runtime/deviceName');
  S.cloud = 'signed-in'; S.account = { id: 'a', name: 'a', email: '' };
  S.agents.dev_a = { id: 'dev_a', name: 'First name', persona: '', kind: 'phone', real: true, status: 'online' };
});

it('D26 AC-4 old telemetry cannot overwrite fresh telemetry after same-account relogin', async () => {
  const old = defer<object>(); m.rpc.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ battery: '42', network: 'wifi' });
  const first = status.syncDeviceStatus('dev_a'); auth.beginAuthChange();
  await status.syncDeviceStatus('dev_a'); expect(S.agents.dev_a.battery).toBe(42);
  old.resolve({ battery: '5', network: 'cellular' }); await first;
  expect(S.agents.dev_a.battery).toBe(42); expect(S.agents.dev_a.network).toBe('Wi-Fi');
});

it('D26 AC-4 a pending old rename neither blocks nor confirms a newer session rename', async () => {
  const old = defer<object>(); m.rpc.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ name: 'New name' });
  const first = names.syncPhoneName('dev_a', 'First name'); const rejected = expect(first).rejects.toThrow('尚未确认');
  auth.beginAuthChange(); S.agents.dev_a.name = 'New name';
  await names.syncPhoneName('dev_a', 'New name'); expect(m.rpc).toHaveBeenCalledTimes(2);
  old.resolve({ name: 'First name' }); await rejected; expect(S.agents.dev_a.name).toBe('New name');
});
