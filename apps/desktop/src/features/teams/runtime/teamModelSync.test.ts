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
it('REFACTOR-01-M1 AC-3 team send whose reply is lost after dispatch is unconfirmed, not reported as failed', async () => {
  mocks.api.mockImplementation(async (_method, path) => {
    if (path === '/api/teams/sync-core/messages') throw new Error('socket hang up');
    if (path === `/api/conversations/${c.id}`) return { id: c.id, model: { provider_id: 'cloud', model: 'new' }, extra: { lom_tier: 'pro' } };
    return {};
  });
  expect(await sendToCoreTeam(t, t.members[0], 'hello', [])).toBe(false);
  expect(c.messages.find(x => x.type === 'user')?.status).toBe('unconfirmed');
  expect(c.messages.at(-1)?.text).toContain('发送结果未确认');
  expect(c.messages.at(-1)?.text).not.toContain('发送失败');
});
it('REFACTOR-01-M1 AC-3 a 4xx rejection after dispatch is still a definite failure', async () => {
  mocks.api.mockImplementation(async (_method, path) => {
    if (path === '/api/teams/sync-core/messages') throw Object.assign(new Error('bad request'), { status: 400 });
    if (path === `/api/conversations/${c.id}`) return { id: c.id, model: { provider_id: 'cloud', model: 'new' }, extra: { lom_tier: 'pro' } };
    return {};
  });
  expect(await sendToCoreTeam(t, t.members[0], 'hello', [])).toBe(false);
  expect(c.messages.find(x => x.type === 'user')?.status).toBe('error');
  expect(c.messages.at(-1)?.text).toContain('发送失败');
});
it('REFACTOR-01-M1 AC-2 team send does not start while the leader stop is unconfirmed', async () => {
  const { beginStop, endStop } = await import('@/features/chat/runtime/turnLedger');
  beginStop(c.id);
  try {
    await expect(sendToCoreTeam(t, t.members[0], 'hello', [])).rejects.toThrow('停止尚未确认');
    expect(mocks.api.mock.calls.some(x => x[1] === '/api/teams/sync-core/messages')).toBe(false);
    expect(c.messages).toEqual([]);
  } finally { endStop(c.id); }
});

it('PA-TOOLS-02 F stopped parent during model synchronization cannot dispatch or append stale records', async () => {
  let live = true, release!: () => void;
  mocks.sync.mockImplementation(() => new Promise<void>(r => { release = r; }));
  const work = sendToCoreTeam(t, t.members[0], 'late', [], () => live);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  live = false; release();
  expect(await work).toBe(false);
  expect(mocks.api.mock.calls.some(x => String(x[1]).endsWith('/messages'))).toBe(false);
  expect(c.messages).toEqual([]);
});
it('PA-TOOLS-02 E incomplete core run-state never reports an idle or stopped team', async () => {
  const { stopCoreTeam } = await import('./coreTeam');
  mocks.api.mockResolvedValue({});
  await expect(stopCoreTeam(t)).rejects.toThrow('状态不完整');
});
it('PA-TOOLS-02 F stopping between model GET and PATCH prevents a late model write', async () => {
  const { ensureTaskModel } = await import('@/features/chat/runtime/taskModel');
  let live = true, resume!: () => void;
  mocks.api.mockImplementation(() => new Promise(r => { resume = () => r({ model: { provider_id: 'cloud', model: 'old' } }); }));
  const pending = ensureTaskModel(c, { id: 'cloud::new', providerId: 'cloud', model: 'new', label: 'new' } as any, () => live);
  live = false; resume(); await expect(pending).rejects.toThrow();
  expect(mocks.api.mock.calls.some(x => x[0] === 'PATCH')).toBe(false);
});
