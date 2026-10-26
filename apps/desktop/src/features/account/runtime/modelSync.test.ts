vi.mock('@/features/account/runtime/serviceConfig', () => ({ cloudConfigured: () => true, LOM_CLOUD_URL: 'https://service.example.invalid', requireCloudService: () => {}, CLOUD_UNAVAILABLE: '后端未包含' }));
import { beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import { currentPcModel } from '@/state/selectors';
const m = vi.hoisted(() => ({ invoke: vi.fn(), api: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
vi.mock('@/core/platform', () => ({ inShell: () => true }));
vi.mock('@/features/phones/runtime/phoneCache', () => ({ loadPhoneCache: vi.fn() }));
vi.mock('@/features/phones/runtime/accountDeviceConfig', () => ({ syncDeviceAccount: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api }));
const { restoreSession, refreshPoints, ensureCloudConfig } = await import('./cloud');
const provider = { id: 'cloud', name: 'Lom 云端', platform: 'openai', base_url: '', models: ['old-pro', 'old-max', 'mini'], enabled: true, created_at: 0 };
const gateway = { base_url: 'https://fixture.invalid/v1', key: 'fixture-key', revision: 2,
  models: { pro: 'new-pro', max: 'new-max', mini: 'mini' }, legacy: { pro: ['old-pro'], max: ['old-max'], mini: ['mini'] } };
const envelope = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
beforeEach(() => {
  m.invoke.mockReset().mockResolvedValue('fixture-session');
  m.api.mockReset().mockImplementation(async (method, path, body) => {
    if (path === '/api/cron/jobs') return [];
    if (path === '/api/providers') return [{ ...provider }];
    if (method === 'PUT' && path === '/api/providers/cloud') Object.assign(provider, body);
    return {};
  });
  provider.models = ['old-pro', 'old-max', 'mini'];
  update(s => {
    s.account = { id: 'a', name: 'A', email: '' }; s.conn = 'ready'; s.cloud = 'signed-in';
    s.cloudModels = { pro: 'old-pro', max: 'old-max', mini: 'mini' }; s.providers = [provider];
    s.model = 'cloud::old-pro'; s.phoneModel = 'cloud::old-max'; s.teams = [];
    s.convs = [{ id: 'c', owner: 'pc', remote: true, title: '', updated: 0, messages: [], modelId: 'cloud::old-pro', providerId: 'cloud' }];
    s.route = { name: 'chat' }; s.activeConv = 'c';
  });
  vi.stubGlobal('fetch', vi.fn(async url => envelope(String(url).endsWith('/v1/model-config') ? gateway : { account: S.account, points: { total: 300 }, gateway })));
  update(s => { s.cloudLegacy = {}; s.cloudModelRevision = -1; });
});
it('MODEL-SYNC-01 restores Lom selection and resolves old history without changing BYOK', async () => {
  await restoreSession();
  expect(S.model).toBe('lom-pro');
  expect(S.phoneModel).toBe('lom-max');
  expect(currentPcModel()?.model).toBe('new-pro');
});
it('MODEL-SYNC-01 normal points refresh also refreshes model configuration', async () => {
  await restoreSession();
  vi.mocked(fetch).mockClear();
  await refreshPoints();
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/v1/model-config'))).toBe(true);
});
it('MODEL-SYNC-01 concurrent refresh shares one request and ignores an old account response', async () => {
  await restoreSession(); m.api.mockClear();
  let finish!: (r: Response) => void;
  vi.mocked(fetch).mockImplementation(() => new Promise(r => { finish = r; }));
  const first = ensureCloudConfig(true), second = ensureCloudConfig(true);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  update(s => { s.account = { id: 'other', name: 'Other', email: '' }; });
  finish(envelope(gateway));
  const result = await Promise.allSettled([first, second]);
  expect(result.every(x => x.status === 'rejected')).toBe(true);
  expect(m.api).not.toHaveBeenCalled();
});
it('MODEL-SYNC-01 synchronization failure is visible and not registered as success', async () => {
  await restoreSession();
  vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
  await expect(ensureCloudConfig(true)).rejects.toThrow('offline');
  expect(S.cloudError).toContain('模型同步失败');
  expect(S.model).toBe('lom-pro');
});

it('MODEL-SYNC-01 a failed forced refresh invalidates a recent success cache', async () => {
  await restoreSession(); await ensureCloudConfig(true);
  vi.mocked(fetch).mockRejectedValue(new Error('offline'));
  await expect(ensureCloudConfig(true)).rejects.toThrow('offline');
  await expect(ensureCloudConfig()).rejects.toThrow('offline');
});
it('MODEL-SYNC-01 a failed cron refresh cannot disable desktop or phone model selection', async () => {
  const original = m.api.getMockImplementation()!;
  m.api.mockImplementation(async (method, path, body) => {
    if (path === '/api/cron/jobs') throw new Error('ongoing conversation jobs must keep their original assistant');
    return original(method, path, body);
  });
  await restoreSession(); await ensureCloudConfig(true);
  await vi.waitFor(() => expect(S.cloudScheduleError).toContain('聊天模型已同步'));
  expect(S.cloudError).toBe('');
  expect(currentPcModel()?.model).toBe('new-pro');
  expect(S.phoneModel).toBe('lom-max');
});
it('MODEL-SYNC-01 pending cron IO does not stall chat model refresh', async () => {
  const original = m.api.getMockImplementation()!;
  let finish!: (rows: unknown[]) => void;
  m.api.mockImplementation(async (method, path, body) => {
    if (path === '/api/cron/jobs') return new Promise(resolve => { finish = resolve; });
    return original(method, path, body);
  });
  try {
    await restoreSession();
    await ensureCloudConfig(true);
    expect(currentPcModel()?.model).toBe('new-pro');
    expect(S.cloudError).toBe('');
  } finally {
    // Drain the bounded background rerun as well as the first list request.
    m.api.mockImplementation(async (method, path, body) => path === '/api/cron/jobs' ? [] : original(method, path, body));
    finish([]); await vi.waitFor(() => expect(S.cloudScheduleError).toBe(''));
  }
});
