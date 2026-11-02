import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { api } from '@/core/client';
import { openTask } from '@/features/chat/runtime/tasks';
import { ensureTaskPermissions } from '@/features/settings/runtime/preferences';
vi.mock('@/core/client', async load => ({ ...await load<typeof import('@/core/client')>(), api: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks(); S.permission = 'auto'; S.prefs.allowInstall = 'allow';
  S.convs = [{ id: 'pa', title: '', owner: 'pc', messages: [], remote: true, updated: 1, personal: { id: 'pa_a', name: '小麓', directory: '/a' } }];
  vi.mocked(api).mockImplementation(async (_method, path) => { if (path.includes('/messages')) throw new Error('history unavailable'); return path.endsWith('/confirmations') ? [] as never : { id: 'pa', model: { provider_id: 'cloud', model: 'pro' }, runtime: { is_processing: false } } as never; });
});
it.each([false, true])('PA02 reports unreadable history instead of exposing a ready assistant (cached=%s)', async loaded => {
  S.convs[0].loaded = loaded;
  await expect(openTask('pa', { refreshWorkspace: false, throwOnError: true })).rejects.toThrow('history unavailable');
});
it('PA02 always applies ask permission without inheriting the main chat full-access mode', async () => {
  await ensureTaskPermissions(S.convs[0]);
  expect(api).toHaveBeenCalledWith('PUT', '/api/conversations/pa/config-options/mode', { value: 'default' });
  expect(S.permission).toBe('auto');
});
