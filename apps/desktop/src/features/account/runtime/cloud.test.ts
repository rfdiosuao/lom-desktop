vi.mock('@/features/account/runtime/serviceConfig', () => ({ cloudConfigured: () => true, LOM_CLOUD_URL: 'https://service.example.invalid', requireCloudService: () => {}, CLOUD_UNAVAILABLE: '后端未包含' }));
import { beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@/core/platform', () => ({ inShell: () => true }));
vi.mock('@/features/phones/runtime/phoneCache', () => ({ loadPhoneCache: vi.fn() }));
vi.mock('@/features/settings/runtime/providerSync', () => ({ refreshProviders: vi.fn() }));
vi.mock('@/core/client', () => ({ api: vi.fn() }));
const { restoreSession, signIn, signOut } = await import('./cloud');
const data = { session: 'test-session', account: { id: 'a', name: 'Test', email: 'test@example.test' }, points: { total: 300 }, gateway: { base_url: null, key: null, models: {} } };
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ success: status === 200, ...(status === 200 ? { data } : data as object) }), { status });
beforeEach(() => {
  invoke.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => response(data)));
  update(s => { s.cloud = 'signed-out'; });
});
it('S04-01 AC-6 无保存会话时停留登录页，且不多次请求钥匙串', async () => {
  invoke.mockResolvedValue(null);
  await Promise.all([restoreSession(), restoreSession()]);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(S.cloud).toBe('signed-out');
  expect(fetch).not.toHaveBeenCalled();
});
it('S04-01 AC-8 验证已保存会话后恢复账号，退出返回入口', async () => {
  invoke.mockResolvedValue('saved');
  await restoreSession();
  expect(S.cloud).toBe('signed-in');
  expect(S.account?.name).toBe('Test');
  await signOut();
  expect(S.cloud).toBe('signed-out');
  expect(S.account).toBeNull();
});
it('S04-01 AC-9 网络故障不清除令牌、不开放工作台，重试可恢复', async () => {
  invoke.mockResolvedValue('saved');
  vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
  await restoreSession();
  expect(S.cloud).toBe('unavailable');
  expect(invoke).not.toHaveBeenCalledWith('session_clear');
  await restoreSession();
  expect(S.cloud).toBe('signed-in');
});
it('S04-01 AC-8 服务端确认过期时清理登录', async () => {
  invoke.mockResolvedValue('expired');
  vi.mocked(fetch).mockResolvedValueOnce(response({ code: 'auth.session_expired' }, 401));
  await restoreSession();
  expect(S.cloud).toBe('signed-out');
  expect(invoke).toHaveBeenCalledWith('session_clear');
});
it.each(['login', 'register', 'google', 'github'] as const)('S04-01 AC-7 %s 登录交换真实会话后才解锁', async method => {
  vi.mocked(fetch).mockResolvedValueOnce(response({ issuer: 'https://service.example.invalid', client_id: 'lom', scope: 'openid profile email' }));
  invoke.mockResolvedValue('id-token');
  await signIn(method);
  expect(invoke).toHaveBeenCalledWith('heang_login', expect.objectContaining({ method }));
  expect(invoke).toHaveBeenCalledWith('session_set', { token: 'test-session' });
  expect(invoke).toHaveBeenCalledWith('login_complete', { success: true });
  expect(S.cloud).toBe('signed-in');
});
it('S04-01 AC-10 重复点击不创建第二个授权流程，拒绝后可重试', async () => {
  let reject!: (e: Error) => void;
  invoke.mockReturnValue(new Promise((_, r) => { reject = r; }));
  const first = signIn('google');
  await signIn('github');
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  expect(S.cloud).toBe('signing-in');
  reject(new Error('auth.denied'));
  await first;
  expect(S.cloud).toBe('signed-out');
});
it('S04-01 AC-7 无会话的登录响应不放行', async () => {
  invoke.mockResolvedValue('id-token');
  vi.mocked(fetch).mockImplementation(async () => response({ ...data, session: undefined }));
  await signIn();
  expect(S.cloud).toBe('signed-out');
  expect(invoke).toHaveBeenCalledWith('login_complete', { success: false });
});
