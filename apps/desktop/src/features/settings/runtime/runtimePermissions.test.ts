import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api }));
import { S } from '@/state/store';
import { initialState } from '@/state/state';
import { ensureTaskPermissions } from './preferences';

beforeEach(() => { vi.resetAllMocks(); Object.assign(S, initialState()); S.permission = 'auto'; S.prefs.allowInstall = 'allow'; });

it('D12 creates and restores the runtime before configuring full-auto, without restarting a live instance', async () => {
  let active = false, starts = 0;
  m.api.mockImplementation(async (_method: string, path: string) => {
    if (path.endsWith('/runtime/ensure')) { if (!active) starts++; active = true; return {}; }
    if (path.endsWith('/config-options/mode')) { if (!active) throw new Error('No active agent for this conversation'); return {}; }
    throw new Error(`Unexpected request: ${path}`);
  });
  const c = { id: 'd12-leader', owner: 'pc', title: '', updated: 0, messages: [] };
  await ensureTaskPermissions(c); expect(starts).toBe(1);
  await ensureTaskPermissions(c); expect(starts).toBe(1);
  active = false;
  await ensureTaskPermissions(c); expect(starts).toBe(2);
});

it('D12 propagates startup failure and does not configure an absent runtime', async () => {
  m.api.mockRejectedValue(new Error('runtime startup failed'));
  await expect(ensureTaskPermissions({ id: 'd12-fail', owner: 'pc', title: '', updated: 0, messages: [] })).rejects.toThrow('runtime startup failed');
  expect(m.api.mock.calls).toEqual([['POST', '/api/conversations/d12-fail/runtime/ensure', {}]]);
});

it('D12 leaves external agent permissions to its own runtime', async () => {
  await ensureTaskPermissions({ id: 'd12-external', agentId: 'codex', owner: 'pc', title: '', updated: 0, messages: [] });
  expect(m.api).not.toHaveBeenCalled();
});

it.each(['ask','deny'] as const)('PA-PERM-01 explicit native full access is not silently downgraded by global %s', async install => {
  const { effectiveMode, publicationPolicy } = await import('./preferences');
  const { PERMISSIONS } = await import('@/state/selectors');
  S.permission = 'full'; S.prefs.allowInstall = install;
  expect(PERMISSIONS.find(p => p.id === 'full')?.name).toBe('完全访问');
  expect(effectiveMode('full')).toBe('yolo');
  m.api.mockResolvedValue({});
  const c = { id: `native-full-${install}`, owner: 'pc', title: '', updated: 0, messages: [], remote: true };
  S.convs = [c];
  await ensureTaskPermissions(c);
  expect(m.api).toHaveBeenCalledWith('PUT', `/api/conversations/${c.id}/config-options/mode`, { value: 'yolo' });
  expect(publicationPolicy(c)).toContain('不再逐项请求');
});

it('PA-PERM-01 native full access downgrade restarts the runtime before restoring ask', async () => {
  const c = { id: 'native-full-downgrade', owner: 'pc', title: '', updated: 0, messages: [], remote: true };
  S.convs = [c]; S.permission = 'full'; m.api.mockResolvedValue({});
  await ensureTaskPermissions(c);
  S.permission = 'ask'; m.api.mockClear(); m.api.mockResolvedValueOnce({ runtime: { has_task: true, is_processing: false } });
  await ensureTaskPermissions(c);
  expect(m.api.mock.calls).toEqual([
    ['GET', '/api/conversations/native-full-downgrade'],
    ['POST', '/api/conversations/native-full-downgrade/runtime/restart', {}],
    ['PUT', '/api/conversations/native-full-downgrade/config-options/mode', { value: 'default' }],
  ]);
});
