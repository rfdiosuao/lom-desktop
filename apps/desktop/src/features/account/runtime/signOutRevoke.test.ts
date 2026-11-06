import { beforeEach, expect, it, vi } from 'vitest';
vi.hoisted(() => vi.stubEnv('VITE_LOM_CLOUD_URL', 'https://service.example.invalid'));
import { S, update } from '@/state/store';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@/core/platform', () => ({ inShell: () => true }));
vi.mock('@/features/phones/runtime/phoneCache', () => ({ loadPhoneCache: vi.fn() }));
vi.mock('@/features/settings/runtime/providerSync', () => ({ refreshProviders: vi.fn() }));
vi.mock('@/core/client', () => ({ api: vi.fn() }));
const { restoreSession, signOut } = await import('./cloud');
const data = { session: 's', account: { id: 'a', name: 'Test', email: 'test@example.test' }, points: { total: 300 }, gateway: { base_url: null, key: null, models: {} } };
const ok = () => new Response(JSON.stringify({ success: true, data }), { status: 200 });
const fail = (code: string, status: number) => new Response(JSON.stringify({ success: false, code, error: '服务端出错' }), { status });
async function signedIn(revoke: () => Promise<Response>) {
  invoke.mockResolvedValue('saved');
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'DELETE' ? revoke() : ok()));
  update(s => { s.cloud = 'signed-out'; s.toast = null; });
  await restoreSession();
  expect(S.cloud).toBe('signed-in');
}
beforeEach(() => { invoke.mockReset(); });

it('SET-ACCOUNT-01 #427 服务端吊销成功：只提示已退出登录', async () => {
  await signedIn(async () => new Response(JSON.stringify({ success: true, data: null }), { status: 200 }));
  await signOut();
  expect(S.toast?.text).toBe('已退出登录');
  expect(S.cloudError).toBe('');
});

it('SET-ACCOUNT-01 #427 吊销失败：本机照常退出，但提示服务端会话未能吊销并带错误码', async () => {
  await signedIn(async () => fail('server.internal', 500));
  await signOut();
  expect(S.cloud).toBe('signed-out');
  expect(S.account).toBeNull();
  expect(invoke).toHaveBeenCalledWith('session_clear');
  expect(S.toast?.text).not.toBe('已退出登录');
  expect(S.toast?.text).toContain('未能吊销');
  expect(S.toast?.text).toContain('auth.revoke_failed');
  expect(S.toast?.tone).toBe('error');
  // 登录页和账号页可见，不会随提示消失
  expect(S.cloudError).toContain('未能吊销');
});

it('SET-ACCOUNT-01 #427 网络不通导致吊销失败同样如实提示', async () => {
  await signedIn(async () => { throw new Error('offline'); });
  await signOut();
  expect(S.toast?.text).toContain('未能吊销');
  expect(S.toast?.text).toContain('cloud.unreachable');
});

it('SET-ACCOUNT-01 #427 服务端说会话本来就已失效：等同已吊销，不误报', async () => {
  await signedIn(async () => fail('auth.session_expired', 401));
  await signOut();
  expect(S.toast?.text).toBe('已退出登录');
});
