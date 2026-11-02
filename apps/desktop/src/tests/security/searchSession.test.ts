vi.mock('@/features/account/runtime/serviceConfig', () => ({ cloudConfigured: () => true, LOM_CLOUD_URL: 'https://service.example.invalid', requireCloudService: () => {}, CLOUD_UNAVAILABLE: '后端未包含' }));
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ api: vi.fn(), invoke: vi.fn(), toast: vi.fn(), toastError: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
vi.mock('@/core/platform', () => ({ inShell: () => true }));
vi.mock('@/shared/overlays/controller', () => ({ toast: m.toast, toastError: m.toastError }));
vi.mock('@/features/phones/runtime/phoneCache', () => ({ loadPhoneCache: vi.fn() }));
vi.mock('@/features/phones/runtime/accountDeviceConfig', () => ({ syncDeviceAccount: vi.fn() }));

const sessionData = {
  account: { id: 'search-fixture', name: 'Fixture', email: '' },
  points: { total: 10, free: 10, paid: 0, period: 'fixture' },
  gateway: { base_url: 'https://models.example.test/v1', key: 'fixture-model-key', models: { pro: 'pro', max: 'max', mini: 'mini' } },
};
const deferred = () => {
  let resolve!: () => void, reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let state: typeof import('@/state/store');
let account: typeof import('@/features/account/runtime/cloud');
let search: (session: string | null) => Promise<void>;
let remote: Record<string, unknown>[];

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear();
  remote = []; search = async () => {};
  m.invoke.mockImplementation(async (command: string) => command === 'session_get' ? 'fixture-search-session' : undefined);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: sessionData }))));
  m.api.mockImplementation(async (method: string, path: string, body?: Record<string, unknown>) => {
    if (path === '/api/lom/search-session') return search(body!.session as string | null);
    if (method === 'GET' && path === '/api/providers') return remote.map(p => ({ ...p }));
    if (method === 'POST' && path === '/api/providers') remote.push({ ...body, id: 'fixture-provider', created_at: 1 });
    if (method === 'PUT' && path === '/api/providers/fixture-provider') Object.assign(remote[0], body);
  });
  state = await import('@/state/store');
  state.S.conn = 'ready'; state.S.cloud = 'signed-out'; state.S.model = ''; state.S.providers = [];
  account = await import('@/features/account/runtime/cloud');
});

it.each(['HTTP 404', 'HTTP 502'])('S05 / D26 AC-9 optional search failure %s leaves normal models available', async failure => {
  search = async () => { throw new Error(failure); };
  await account.restoreSession();
  expect(state.S.cloud).toBe('signed-in');
  expect(state.S.providers).toEqual([expect.objectContaining({ id: 'fixture-provider', enabled: true })]);
  expect(state.S.model).toBe('lom-pro');
  expect(m.toast).toHaveBeenCalledWith('联网搜索暂不可用，普通对话可继续。', 'info');
});

it('S05 / D26 AC-9 a stalled search initialization does not hold up normal model provisioning', async () => {
  const pending = deferred(); search = () => pending.promise;
  try {
    await account.restoreSession();
    expect(state.S.model).toBe('lom-pro');
    expect(state.S.providers[0].enabled).toBe(true);
  } finally { pending.resolve(); }
});

it('S05 / D26 AC-9 logout clears search immediately and ignores late failure from the previous session', async () => {
  const pending = deferred();
  search = session => session ? pending.promise : Promise.resolve();
  await account.restoreSession();
  m.toast.mockClear();
  const logout = account.signOut();
  expect(m.api).toHaveBeenCalledWith('PUT', '/api/lom/search-session', { session: null }, expect.anything());
  pending.reject(new Error('fixture-late-failure'));
  await logout;
  expect(state.S.cloud).toBe('signed-out');
  expect(state.S.account).toBeNull();
  expect(m.toast).not.toHaveBeenCalledWith('联网搜索暂不可用，普通对话可继续。', 'info');
  expect(remote[0]).toMatchObject({ enabled: false, api_key: '' });
});
