vi.mock('@/features/account/runtime/serviceConfig', () => ({ cloudConfigured: () => true, LOM_CLOUD_URL: 'https://service.example.invalid', requireCloudService: () => {}, CLOUD_UNAVAILABLE: '后端未包含' }));
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ invoke: vi.fn(), api: vi.fn(), toast: vi.fn(), toastError: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
vi.mock('@/core/platform', () => ({ inShell: () => true }));
vi.mock('@/core/client', () => ({ api: m.api }));
vi.mock('@/shared/overlays/controller', () => ({ toast: m.toast, toastError: m.toastError }));
vi.mock('@/features/phones/runtime/phoneCache', () => ({ loadPhoneCache: vi.fn() }));

const defer = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
};
const data = (id = 'a') => ({ session: `fixture-${id}`, account: { id, name: id, email: '' },
  points: { total: 10, free: 10, paid: 0, period: 'fixture' },
  gateway: { base_url: null as string | null, key: null as string | null, models: { pro: 'pro', max: 'max', mini: 'mini' } } });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(status === 200 ? { success: true, data: value } : value), { status });
let store: typeof import('@/state/store');
let cloud: typeof import('@/features/account/runtime/cloud');

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear();
  m.invoke.mockImplementation(async (command: string) => command === 'session_get' ? 'fixture-session' : undefined);
  m.api.mockResolvedValue([]);
  vi.stubGlobal('fetch', vi.fn(async () => response(data())));
  store = await import('@/state/store');
  store.S.conn = 'offline'; store.S.cloud = 'signed-out';
  cloud = await import('@/features/account/runtime/cloud');
});

it('D26 AC-4 late repair cannot reopen the signed-out workspace', async () => {
  await cloud.restoreSession();
  const pending = defer<Response>(); vi.mocked(fetch).mockReturnValueOnce(pending.promise);
  const repairing = cloud.repairBuiltin();
  await cloud.signOut(); pending.resolve(response(data())); await repairing;
  expect(store.S.cloud).toBe('signed-out'); expect(store.S.account).toBeNull(); expect(store.S.points).toBeNull();
});

it('D26 AC-4 delayed keychain restoration cannot survive sign-out', async () => {
  const saved = defer<string>(); m.invoke.mockReturnValueOnce(saved.promise);
  const restoring = cloud.restoreSession(); await cloud.signOut(); saved.resolve('fixture-old'); await restoring;
  expect(store.S.cloud).toBe('signed-out'); expect(fetch).not.toHaveBeenCalled();
});

it('D26 AC-4 a cancelled browser login never exchanges or persists its late token', async () => {
  const browser = defer<string>(); m.invoke.mockImplementation(command => command === 'heang_login' ? browser.promise : Promise.resolve());
  vi.mocked(fetch).mockResolvedValueOnce(response({ issuer: 'https://example.test', client_id: 'fixture', scope: 'openid' }));
  const login = cloud.signIn(); await vi.waitFor(() => expect(m.invoke).toHaveBeenCalledWith('heang_login', expect.anything()));
  await cloud.signOut(); browser.resolve('fixture-id-token'); await login;
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  expect(m.invoke.mock.calls.some(([command]) => command === 'session_set')).toBe(false);
  expect(store.S.cloud).toBe('signed-out');
});

it('D26 AC-4 logout serializes keychain clear after an already-started credential write', async () => {
  const saving = defer<void>(); let stored: string | null = null;
  m.invoke.mockImplementation(async (command: string, args?: { token: string }) => {
    if (command === 'heang_login') return 'fixture-id-token';
    if (command === 'session_set') { await saving.promise; stored = args!.token; }
    if (command === 'session_clear') stored = null;
  });
  const login = cloud.signIn(); await vi.waitFor(() => expect(m.invoke).toHaveBeenCalledWith('session_set', expect.anything()));
  const logout = cloud.signOut(); expect(store.S.cloud).toBe('signed-out');
  saving.resolve(); await Promise.all([login, logout]);
  expect(stored).toBeNull(); expect(store.S.account).toBeNull();
  expect(m.invoke).not.toHaveBeenCalledWith('login_complete', { success: true });
});

it('D26 AC-4 an expired response from the old account cannot clear a new login', async () => {
  await cloud.restoreSession(); const pending = defer<Response>();
  vi.mocked(fetch).mockReturnValueOnce(pending.promise); const repairing = cloud.repairBuiltin();
  await cloud.signOut(); vi.mocked(fetch).mockResolvedValueOnce(response(data('b'))); await cloud.restoreSession();
  pending.resolve(response({ success: false, code: 'auth.session_expired' }, 401)); await repairing;
  expect(store.S.account?.id).toBe('b'); expect(store.S.cloud).toBe('signed-in');
});

it('D26 AC-4 delayed points cannot repopulate an account after logout', async () => {
  await cloud.restoreSession();
  store.S.providers = [{ id: 'builtin', name: cloud.LOM_PROVIDER_NAME, enabled: true } as never];
  const pending = defer<Response>(); vi.mocked(fetch).mockReturnValueOnce(pending.promise);
  const refreshing = cloud.refreshPoints();
  await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/v1/points'))).toBe(true));
  await cloud.signOut();
  pending.resolve(response({ total: 999 })); await refreshing; expect(store.S.points).toBeNull();
});

it.each(['profile', 'redeem'] as const)('D26 AC-4 a delayed %s response cannot mutate another session', async action => {
  await cloud.restoreSession(); const pending = defer<Response>(); vi.mocked(fetch).mockReturnValueOnce(pending.promise);
  const request = action === 'profile' ? cloud.saveProfile('changed', null) : cloud.redeemCode('fixture-code');
  const rejected = expect(request).rejects.toMatchObject({ code: 'auth.session_changed' });
  await cloud.signOut();
  pending.resolve(response(action === 'profile' ? data().account : { points: data().points, added: 1, credited: true, plan: null }));
  await rejected; expect(store.S.account).toBeNull(); expect(store.S.points).toBeNull();
});

it('D26 AC-4 delayed subscription reads neither overwrite nor block the new account', async () => {
  await cloud.restoreSession(); const plans = await import('@/features/account/runtime/plans');
  const old = defer<Response>(); let oldRequests = true;
  const plan = (name: string) => ({ name, tier: null, ends_at: null, models: [], max_phones: 1, discount_pct: 100, daily_points: 1 });
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    const path = String(url);
    if (path.endsWith('/v1/plans') || path.endsWith('/v1/subscription')) {
      if (oldRequests) return old.promise;
      return response(path.endsWith('/v1/plans') ? { tiers: [], free: plan('b'), online_payment: false } : { plan: plan('b'), next_tier: null, next_days: null });
    }
    return response(init?.method === 'DELETE' ? {} : data('b'));
  });
  const first = plans.loadPlans(); await cloud.signOut(); await cloud.restoreSession(); oldRequests = false;
  await plans.loadPlans(); expect(store.S.subscription?.plan.name).toBe('b');
  old.resolve(response({ tiers: [], free: plan('a'), plan: plan('a') })); await first;
  expect(store.S.subscription?.plan.name).toBe('b'); expect(store.S.plansError).toBe('');
});

it('D26 AC-4 a provider created late is disabled and stripped of its old credential', async () => {
  type Remote = { id: string; name: string; enabled: boolean; api_key?: string };
  let remote: Remote[] = []; const creating = defer<void>();
  m.api.mockImplementation(async (method: string, _path: string, body?: Remote) => {
    if (method === 'GET') return remote.map(p => ({ ...p }));
    if (method === 'POST') { await creating.promise; remote = [{ ...body!, id: 'builtin' }]; }
    if (method === 'PUT') Object.assign(remote[0], body);
  });
  const account = data(); account.gateway.base_url = 'https://gateway.example.test'; account.gateway.key = 'fixture-gateway-credential';
  vi.mocked(fetch).mockImplementation(async () => response(account)); store.S.conn = 'ready';
  const restoring = cloud.restoreSession(); await vi.waitFor(() => expect(m.api.mock.calls.some(([method]) => method === 'POST')).toBe(true));
  const logout = cloud.signOut(); expect(store.S.cloud).toBe('signed-out');
  creating.resolve(); await Promise.all([restoring, logout]);
  expect(remote[0]).toMatchObject({ enabled: false, api_key: '' });
  expect(store.S.cloudModels).toBeNull(); expect(store.S.model).toBe('');
});

it('D26 AC-4 queued old provider writes cannot replace a newly signed-in account gateway', async () => {
  type Remote = { id: string; name: string; enabled: boolean; api_key?: string; base_url?: string };
  let remote: Remote[] = []; const creating = defer<void>();
  m.api.mockImplementation(async (method: string, _path: string, body?: Remote) => {
    if (method === 'GET') return remote.map(p => ({ ...p }));
    if (method === 'POST') { await creating.promise; remote = [{ ...body!, id: 'builtin' }]; }
    if (method === 'PUT') Object.assign(remote[0], body);
  });
  const first = data('a'); first.gateway.base_url = 'https://a.example.test'; first.gateway.key = 'fixture-a';
  vi.mocked(fetch).mockImplementation(async () => response(first)); store.S.conn = 'ready';
  const restoring = cloud.restoreSession(); await vi.waitFor(() => expect(m.api.mock.calls.some(([method]) => method === 'POST')).toBe(true));
  const logout = cloud.signOut();
  const second = data('b'); second.gateway.base_url = 'https://b.example.test'; second.gateway.key = 'fixture-b';
  vi.mocked(fetch).mockImplementation(async () => response(second));
  m.invoke.mockImplementation(async command => command === 'heang_login' ? 'fixture-id-token' : undefined);
  const login = cloud.signIn(); await vi.waitFor(() => expect(store.S.account?.id).toBe('b'));
  creating.resolve(); await Promise.all([restoring, logout, login]);
  expect(remote[0]).toMatchObject({ enabled: true, api_key: 'fixture-b', base_url: 'https://b.example.test' });
  expect(store.S.account?.id).toBe('b'); expect(store.S.model).toBe('lom-pro');
});

it.each(['config', 'exchange'] as const)('D26 AC-4 failed %s retry cannot cancel mandatory old credential cleanup', async failure => {
  const saving = defer<void>(); let stored: string | null = null;
  m.invoke.mockImplementation(async (command: string, args?: { token: string }) => {
    if (command === 'heang_login') return 'fixture-id-token';
    if (command === 'session_set') { await saving.promise; stored = args!.token; }
    if (command === 'session_clear') stored = null;
  });
  const first = cloud.signIn(); await vi.waitFor(() => expect(m.invoke).toHaveBeenCalledWith('session_set', expect.anything()));
  const logout = cloud.signOut();
  vi.mocked(fetch).mockImplementation(async url => {
    if (failure === 'config' || String(url).endsWith('/v1/session')) return response({ success: false, code: 'auth.denied', error: 'fixture denied' }, 401);
    return response({ issuer: 'https://example.test', client_id: 'fixture', scope: 'openid' });
  });
  await cloud.signIn(); saving.resolve(); await Promise.all([first, logout]);
  expect(stored).toBeNull(); expect(store.S.cloud).toBe('signed-out');
});

it.each(['config', 'exchange'] as const)('D26 AC-4 failed %s retry cannot cancel mandatory old provider cleanup', async failure => {
  type Remote = { id: string; name: string; enabled: boolean; api_key?: string };
  let remote: Remote[] = []; const creating = defer<void>();
  m.api.mockImplementation(async (method: string, _path: string, body?: Remote) => {
    if (method === 'GET') return remote.map(p => ({ ...p }));
    if (method === 'POST') { await creating.promise; remote = [{ ...body!, id: 'builtin' }]; }
    if (method === 'PUT') Object.assign(remote[0], body);
  });
  const first = data(); first.gateway.base_url = 'https://a.example.test'; first.gateway.key = 'fixture-a';
  vi.mocked(fetch).mockImplementation(async () => response(first)); store.S.conn = 'ready';
  const restoring = cloud.restoreSession(); await vi.waitFor(() => expect(m.api.mock.calls.some(([method]) => method === 'POST')).toBe(true));
  const logout = cloud.signOut();
  vi.mocked(fetch).mockImplementation(async url => {
    if (failure === 'config' || String(url).endsWith('/v1/session')) return response({ success: false, code: 'auth.denied', error: 'fixture denied' }, 401);
    return response({ issuer: 'https://example.test', client_id: 'fixture', scope: 'openid' });
  });
  m.invoke.mockImplementation(async command => command === 'heang_login' ? 'fixture-id-token' : undefined);
  await cloud.signIn(); creating.resolve(); await Promise.all([restoring, logout]);
  expect(remote[0]).toMatchObject({ enabled: false, api_key: '' }); expect(store.S.cloud).toBe('signed-out');
});

it('D26 AC-4 core reconnect clears credentials retained while logout happened offline', async () => {
  await cloud.restoreSession();
  const remote = { id: 'builtin', name: cloud.LOM_PROVIDER_NAME, enabled: true, api_key: 'fixture-old' };
  store.S.providers = [{ ...remote } as never];
  m.api.mockImplementation(async (method: string, _path: string, body?: object) => {
    if (method === 'GET') return [{ ...remote }];
    Object.assign(remote, body);
  });
  await cloud.signOut(); expect(remote.enabled).toBe(true);
  store.S.conn = 'ready'; await cloud.syncCoreAccount();
  expect(remote).toMatchObject({ enabled: false, api_key: '' }); expect(store.S.providers[0].enabled).toBe(false);
  expect(store.S.cloud).toBe('signed-out'); expect(m.invoke.mock.calls.some(([command]) => command === 'heang_login')).toBe(false);
});
