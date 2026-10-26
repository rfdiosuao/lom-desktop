import { beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import { currentPcModel } from '@/state/selectors';
import type { Conv } from '@/state/types';
const api = vi.fn();
vi.mock('@/core/client', () => ({ api: (...args: unknown[]) => api(...args) }));
const { ensureTaskModel } = await import('./taskModel');
const c: Conv = { id: 'task', owner: 'pc', title: 'test', updated: 0, messages: [], remote: true, providerId: 'cloud', modelId: 'cloud::same' };
beforeEach(() => {
  api.mockReset(); c.providerId = 'cloud'; c.modelId = 'cloud::same'; c.lomTier = undefined;
  update(s => {
    s.convs = [c]; s.activeConv = c.id; s.route = { name: 'chat' };
    s.cloud = 'signed-in'; s.account = { id: 'a', name: 'a', email: '' };
    s.model = 'own::same'; s.cloudModels = { pro: 'same', max: 'max', mini: 'mini' };
    s.providers = [
      { id: 'cloud', name: 'Lom 云端', models: ['same'], platform: 'openai', base_url: '', enabled: true, created_at: 0 },
      { id: 'own', name: '我的 Key', models: ['same'], platform: 'openai', base_url: '', enabled: true, created_at: 0 },
    ];
  });
});
it('MODEL-SYNC-01 persists logical tier only after core confirms the new physical model', async () => {
  api.mockResolvedValueOnce({ model: { provider_id: 'cloud', model: 'old' }, extra: { workspace: '/work' } })
    .mockResolvedValueOnce({ model: { provider_id: 'cloud', model: 'same' }, extra: { lom_tier: 'pro', workspace: '/work' } });
  await ensureTaskModel(c, { id: 'cloud::same', name: 'Lom Pro', desc: '', cost: '', providerId: 'cloud', model: 'same', lomTier: 'pro' });
  expect(c.modelId).toBe('cloud::same'); expect(c.lomTier).toBe('pro');
  expect(api).toHaveBeenCalledWith('PATCH', '/api/conversations/task', { model: { provider_id: 'cloud', model: 'same' }, extra: { lom_tier: 'pro' } });
});
it('MODEL-SYNC-03 migrates a historical model without rewriting immutable snapshots or concurrent metadata', async () => {
  const snapshots = { skills: [], mcp_server_ids: ['server'], mcp_servers: [], mcp_statuses: {}, session_mcp_servers: [] };
  let remote = { model: { provider_id: 'cloud', model: 'old' }, extra: { ...snapshots, workspace: '/old-work', lom_tier: undefined as string | null | undefined } };
  api.mockImplementation(async (method, _path, body) => {
    if (method === 'GET') return structuredClone(remote);
    remote.extra.workspace = '/concurrent-work';
    if (Object.keys(body.extra || {}).some(k => k in snapshots)) throw new Error('extra.skills and MCP snapshots are immutable post-creation');
    remote = { model: body.model, extra: { ...remote.extra, ...body.extra } };
    return remote;
  });
  await ensureTaskModel(c, { id: 'lom-pro', name: 'Lom Pro', desc: '', cost: '', providerId: 'cloud', model: 'same', lomTier: 'pro' });
  expect(c.modelId).toBe('cloud::same'); expect(c.lomTier).toBe('pro');
  expect(remote.extra).toEqual({ ...snapshots, workspace: '/concurrent-work', lom_tier: 'pro' });
});
it('MODEL-SYNC-03 switching a Lom task to BYOK clears only the logical tier', async () => {
  api.mockResolvedValueOnce({ model: { provider_id: 'cloud', model: 'same' }, extra: { lom_tier: 'pro', skills: [], workspace: '/work' } })
    .mockResolvedValueOnce({ model: { provider_id: 'own', model: 'same' }, extra: { lom_tier: null, skills: [], workspace: '/work' } });
  await ensureTaskModel(c, { id: 'own::same', name: 'same', desc: '', cost: '', providerId: 'own', model: 'same' });
  expect(api).toHaveBeenCalledWith('PATCH', '/api/conversations/task', { model: { provider_id: 'own', model: 'same' }, extra: { lom_tier: null } });
  expect(c.providerId).toBe('own'); expect(c.lomTier).toBeNull();
});
it('MODEL-SYNC-01 missing core tier confirmation blocks success registration', async () => {
  api.mockResolvedValue({ model: { provider_id: 'cloud', model: 'same' } });
  await expect(ensureTaskModel(c, { id: 'cloud::same', name: 'Lom Pro', desc: '', cost: '', providerId: 'cloud', model: 'same', lomTier: 'pro' })).rejects.toThrow('未确认Lom档位');
  expect(c.lomTier).toBeUndefined();
});
it('打开历史任务显示任务实际模型，不借用全局选择伪装成 BYOK', () => {
  expect(currentPcModel()?.providerId).toBe('cloud');
});
it('同名模型切换也必须更换 provider，确认后才显示 BYOK', async () => {
  api.mockResolvedValueOnce({ model: { provider_id: 'cloud', model: 'same' } })
    .mockResolvedValueOnce({ model: { provider_id: 'own', model: 'same' } });
  await ensureTaskModel(c, { id: 'own::same', name: 'same', desc: '', cost: '', providerId: 'own', model: 'same' });
  expect(api).toHaveBeenCalledWith('PATCH', '/api/conversations/task', { model: { provider_id: 'own', model: 'same' } });
  expect(currentPcModel()?.byok).toBe(true);
});
it('切换失败不把界面伪装成自带 Key', async () => {
  api.mockResolvedValueOnce({ model: { provider_id: 'cloud', model: 'same' } }).mockRejectedValueOnce(new Error('disconnected'));
  await expect(ensureTaskModel(c, { id: 'own::same', name: 'same', desc: '', cost: '', providerId: 'own', model: 'same' })).rejects.toThrow('disconnected');
  expect(c.providerId).toBe('cloud');
});
it('自带 Key 被移除后，不静默回退到扣积分模型', () => {
  update(() => { c.modelId = 'removed::model'; });
  expect(currentPcModel()).toBeUndefined();
  expect(S.points).toBeNull();
});

it('MODEL-SYNC-01 switching accounts during model confirmation blocks the old account patch', async () => {
  api.mockImplementationOnce(async () => { S.account = { id: 'b', name: 'B', email: '' }; return { model: { provider_id: 'cloud', model: 'old' } }; });
  await expect(ensureTaskModel(c, { id: 'lom-pro', name: 'Lom Pro', desc: '', cost: '', providerId: 'cloud', model: 'same', lomTier: 'pro' })).rejects.toThrow('账号已切换');
  expect(api).toHaveBeenCalledTimes(1); expect(c.lomTier).toBeUndefined();
});
