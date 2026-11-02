import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv, Team } from '@/state/types';
const mocks = vi.hoisted(() => ({ api: vi.fn(), sync: vi.fn() }));
vi.mock('@/core/client', () => ({ api: mocks.api, getEndpoint: () => null }));
vi.mock('@/features/account/runtime/cloud', () => ({ ensureLomSelection: mocks.sync }));
const { sendToCoreTeam } = await import('./coreTeam');
let t: Team, c: Conv;
beforeEach(() => {
  mocks.api.mockReset(); mocks.sync.mockReset().mockResolvedValue(undefined);
  S.cloud = 'signed-in'; S.account = { id: 'a', name: 'A', email: '' }; S.cloudAllowed = null;
  S.providers = [{ id: 'cloud', name: 'Lom 云端', models: ['new'], enabled: true }] as typeof S.providers;
  S.cloudModels = { pro: 'new', max: 'max', mini: 'mini' }; S.cloudLegacy = { pro: ['old'] }; S.cloudExtra = []; S.running = {};
  c = { id: 'lead-sync', owner: 'pc', remote: true, modelId: 'cloud::old', lomTier: 'pro', title: '', updated: 0, messages: [] };
  t = { id: 'sync', name: 'team', folder: '', real: true, created: 0, panes: {}, leaderConv: c.id, members: [{ mid: 'l', agent: 'pc', leader: true, role: 'leader' }], core: { id: 'sync-core', assistant: 'a', slots: { l: 'slot' } } };
  S.teams = [t]; S.convs = [c];
  let remote = { id: c.id, model: { provider_id: 'cloud', model: 'old' }, extra: { lom_tier: 'pro' } };
  mocks.api.mockImplementation(async (method, path, body) => {
    if (path === `/api/conversations/${c.id}`) { if (method === 'PATCH') remote = { ...remote, ...body }; return remote; }
    return {};
  });
});
it('MODEL-SYNC-01 team send confirms new leader mapping before posting a message', async () => {
  await sendToCoreTeam(t, t.members[0], 'hello', []);
  const patch = mocks.api.mock.calls.findIndex(x => x[0] === 'PATCH' && x[1] === `/api/conversations/${c.id}`);
  const send = mocks.api.mock.calls.findIndex(x => x[1] === '/api/teams/sync-core/messages');
  expect(patch).toBeGreaterThanOrEqual(0); expect(send).toBeGreaterThan(patch);
  expect(c.modelId).toBe('cloud::new'); expect(c.lomTier).toBe('pro');
});
it('MODEL-SYNC-01 failed team config sync does not dispatch a message', async () => {
  mocks.sync.mockRejectedValue(new Error('offline'));
  expect(await sendToCoreTeam(t, t.members[0], 'hello', [])).toBe(false);
  expect(c.messages.at(-1)?.text).toContain('offline');
  expect(mocks.api.mock.calls.some(x => x[1] === '/api/teams/sync-core/messages')).toBe(false);
});
