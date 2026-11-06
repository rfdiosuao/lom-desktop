import { beforeEach, expect, it, vi } from 'vitest';
import { CoreError } from '@/core/client';
import { initialState } from '@/state/state';
import { S } from '@/state/store';

const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', async original => ({ ...await original<typeof import('@/core/client')>(), api: mock.api }));
import { refreshSnapshot, resetSnapshot, snapshotGuard } from './snapshot';

const change = (relative: string, operation: string) => ({ file_path: `/w/proj/${relative}`, relative_path: relative, operation });
function core(handlers: Record<string, unknown>) {
  mock.api.mockImplementation(async (_m: string, path: string) => {
    const h = handlers[path];
    if (h instanceof Error) throw h;
    return h;
  });
}
beforeEach(() => { Object.assign(S, initialState()); S.homeDir = '/Users/me'; mock.api.mockReset(); resetSnapshot(); });

it('WS-SNAPSHOT-01 #402 reads real changes from the core snapshot and merges staged with unstaged', async () => {
  core({
    '/api/fs/snapshot/init': { mode: 'git-repo', branch: 'main' },
    '/api/fs/snapshot/compare': { staged: [change('a.ts', 'create')], unstaged: [change('a.ts', 'modify'), change('gone.md', 'delete')] },
  });
  await refreshSnapshot('/w/proj');
  expect(mock.api).toHaveBeenCalledWith('POST', '/api/fs/snapshot/init', { workspace: '/w/proj' });
  expect(mock.api).toHaveBeenCalledWith('POST', '/api/fs/snapshot/compare', { workspace: '/w/proj' });
  expect(S.snapshot).toMatchObject({ workspace: '/w/proj', status: 'ready', mode: 'git-repo', branch: 'main' });
  expect(S.snapshot.changes).toEqual([
    { path: '/w/proj/a.ts', relative: 'a.ts', operation: 'modify', staged: true },
    { path: '/w/proj/gone.md', relative: 'gone.md', operation: 'delete', staged: false },
  ]);
});

it('WS-SNAPSHOT-01 #402 a core failure is shown with its code, never as an empty change list', async () => {
  core({ '/api/fs/snapshot/init': new CoreError('FILE_INTERNAL', '快照失败') });
  await refreshSnapshot('/w/proj');
  expect(S.snapshot).toMatchObject({ status: 'error', code: 'FILE_INTERNAL', changes: [] });
  expect(S.snapshot.error).toContain('快照失败');
});

it('WS-SNAPSHOT-01 #402 a malformed compare reply is an error, not zero changes', async () => {
  core({ '/api/fs/snapshot/init': { mode: 'snapshot', branch: null }, '/api/fs/snapshot/compare': { staged: 'x' } });
  await refreshSnapshot('/w/proj');
  expect(S.snapshot).toMatchObject({ status: 'error', code: 'workspace.snapshot_bad_response' });
});

it('WS-SNAPSHOT-01 #402 a broad folder is not snapshotted unless the user forces it', async () => {
  core({ '/api/fs/snapshot/init': { mode: 'snapshot', branch: null }, '/api/fs/snapshot/compare': { staged: [], unstaged: [] } });
  for (const dir of ['/Users/me', '/Users/me/Documents', '/']) expect(snapshotGuard(dir)).not.toBe('');
  expect(snapshotGuard('/w/proj')).toBe('');
  await refreshSnapshot('/Users/me');
  expect(mock.api).not.toHaveBeenCalled();
  expect(S.snapshot).toMatchObject({ status: 'guarded', workspace: '/Users/me' });
  await refreshSnapshot('/Users/me', { force: true });
  expect(S.snapshot.status).toBe('ready');
});

it('WS-SNAPSHOT-01 #402 shadow-snapshot mode remembers when the baseline was taken and keeps it across refreshes', async () => {
  core({ '/api/fs/snapshot/init': { mode: 'snapshot', branch: null }, '/api/fs/snapshot/compare': { staged: [], unstaged: [] } });
  const before = Date.now();
  await refreshSnapshot('/w/proj');
  expect(S.snapshot.since).toBeGreaterThanOrEqual(before);
  const first = S.snapshot.since;
  await refreshSnapshot('/w/proj');
  expect(S.snapshot.since).toBe(first);
});

it('WS-SNAPSHOT-01 #402 a slow reply for a previous folder never overwrites the current folder', async () => {
  let release: (v: unknown) => void = () => {};
  mock.api.mockImplementation(async (_m: string, path: string, body: { workspace: string }) => {
    if (path.endsWith('/init')) return { mode: 'git-repo', branch: 'main' };
    if (body.workspace === '/w/old') await new Promise(r => { release = r; });
    return { staged: [], unstaged: [change(body.workspace === '/w/old' ? 'old.ts' : 'new.ts', 'modify')] };
  });
  const old = refreshSnapshot('/w/old');
  await refreshSnapshot('/w/new');
  release(null);
  await old;
  expect(S.snapshot.workspace).toBe('/w/new');
  expect(S.snapshot.changes.map(c => c.relative)).toEqual(['new.ts']);
});
