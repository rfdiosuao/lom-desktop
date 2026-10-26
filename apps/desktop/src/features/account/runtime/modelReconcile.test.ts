import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
const api = vi.hoisted(() => vi.fn());
vi.mock('@/core/client', () => ({ api }));
const { reconcileSchedules } = await import('./modelReconcile');
const models = { pro: 'new', max: 'max', mini: 'mini' }, legacy = { pro: ['old'] };
beforeEach(() => { api.mockReset(); S.cloudExtra = []; S.running = {}; });
it('MODEL-SYNC-01 migrates only a Lom cron config and verifies the saved result', async () => {
  const rows = ['cloud', 'own'].map(id => ({ id, metadata: { conversation_id: id, agent_config: { name: 'task', workspace: '/work', model: { provider_id: id, model: 'old' } } } }));
  api.mockImplementation(async (method, _path, body) => {
    if (method === 'GET') return structuredClone(rows);
    rows[0].metadata.agent_config = body.agent_config;
  });
  await reconcileSchedules('cloud', models, legacy, () => true);
  expect(rows[0].metadata.agent_config.model.model).toBe('new');
  expect(rows[1].metadata.agent_config.model.model).toBe('old');
  expect(api).toHaveBeenCalledWith('PUT', '/api/cron/jobs/cloud', { agent_config: { name: 'task', workspace: '/work', model: { provider_id: 'cloud', model: 'new' } } });
});
it('MODEL-SYNC-01 unchanged or unconfirmed cron never reports migration success', async () => {
  api.mockResolvedValue([{ id: 'c', metadata: { conversation_id: 'c', agent_config: { model: { provider_id: 'cloud', model: 'old' } } } }]);
  await expect(reconcileSchedules('cloud', models, legacy, () => true)).resolves.toEqual([{ id: 'c', name: 'c', reason: 'update_failed' }]);
});

it('MODEL-SYNC-01 unknown scheduled Lom model is a sync error', async () => {
  api.mockResolvedValue([{ id: 'c', metadata: { conversation_id: 'c', agent_config: { model: { provider_id: 'cloud', model: 'unknown' } } } }]);
  await expect(reconcileSchedules('cloud', models, legacy, () => true)).resolves.toEqual([{ id: 'c', name: 'c', reason: 'model_unknown' }]);
  expect(api.mock.calls.some(c => c[0] === 'PUT')).toBe(false);
});
it('MODEL-SYNC-01 never replaces the assistant of a task bound to an existing conversation', async () => {
  api.mockResolvedValue([{ id: 'heartbeat', target: { execution_mode: 'existing' }, metadata: { conversation_id: 'personal', agent_config: { assistant_id: 'owner', model: { provider_id: 'cloud', model: 'old' } } } }]);
  await reconcileSchedules('cloud', models, legacy, () => true);
  expect(api.mock.calls.some(c => c[0] === 'PUT')).toBe(false);
});
it('MODEL-SYNC-01 one invalid scheduled model does not prevent other cron migrations', async () => {
  const rows = [
    { id: 'bad', metadata: { conversation_id: 'a', agent_config: { model: { provider_id: 'cloud', model: 'unknown' } } } },
    { id: 'good', metadata: { conversation_id: 'b', agent_config: { model: { provider_id: 'cloud', model: 'old' } } } },
  ];
  api.mockImplementation(async (method, path, body) => {
    if (method === 'GET') return structuredClone(rows);
    if (path === '/api/cron/jobs/good') rows[1].metadata.agent_config = body.agent_config;
  });
  const issues = await reconcileSchedules('cloud', models, legacy, () => true);
  expect(rows[1].metadata.agent_config.model.model).toBe('new');
  expect(issues).toEqual([{ id: 'bad', name: 'bad', reason: 'model_unknown' }]);
});
