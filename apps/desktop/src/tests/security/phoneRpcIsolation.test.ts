import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ cloud: vi.fn(), invoke: vi.fn() }));
vi.mock('@/features/account/runtime/cloud', () => ({ cloud: m.cloud }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
let S: typeof import('@/state/store')['S'];
let auth: typeof import('@/features/account/runtime/authScope');
let rpc: typeof import('@/features/phones/runtime/phoneRpc');
const defer = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear();
  ({ S } = await import('@/state/store')); auth = await import('@/features/account/runtime/authScope');
  rpc = await import('@/features/phones/runtime/phoneRpc');
  S.cloud = 'signed-in'; S.account = { id: 'a', name: 'a', email: '' };
});

it('D26 AC-4 sealed work cannot be sent through a later login of the same account', async () => {
  const sealing = defer<object>(); m.invoke.mockReturnValueOnce(sealing.promise);
  const job = rpc.phoneRpc('dev_a', 'document.read', {}); const rejected = expect(job).rejects.toThrow('账号已切换');
  auth.beginAuthChange(); S.cloud = 'signed-out'; auth.beginAuthChange(); S.cloud = 'signed-in';
  sealing.resolve({ id: 'fixture', ciphertext: 'opaque' }); await rejected;
  expect(m.cloud).not.toHaveBeenCalled();
});

it('D26 AC-4 a decrypted response is discarded after an account change during native work', async () => {
  const opening = defer<string>();
  m.invoke.mockImplementation(async (command: string, args: { id: string }) => command === 'remote_seal' ? { id: args.id, ciphertext: 'opaque' } : opening.promise);
  m.cloud.mockImplementation(async (_method: string, _path: string, envelope: object) => envelope);
  const job = rpc.phoneRpc('dev_a', 'document.read', {}); const rejected = expect(job).rejects.toThrow('账号已切换');
  await vi.waitFor(() => expect(m.invoke).toHaveBeenCalledWith('remote_open', expect.anything()));
  auth.beginAuthChange(); S.account = { id: 'b', name: 'b', email: '' };
  opening.resolve(JSON.stringify({ status: 'ok', payload: JSON.stringify({ text: 'old private content' }) })); await rejected;
});
