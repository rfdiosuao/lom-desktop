import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initialState } from '@/state/state';
import { S, update } from '@/state/store';
import type { Msg } from '@/state/types';

const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', async original => ({ ...await original<typeof import('@/core/client')>(), api: mock.api }));
import { resetSnapshot } from './snapshot';
import { startTurnBaseline, stopTurnBaseline, turnChangesFromBase } from './turnBase';

const row = (relative: string, operation: string) => ({ file_path: `/w/proj/${relative}`, relative_path: relative, operation });
let compare: unknown;
const user = (id: string, at = Date.now()): Msg => ({ id, type: 'user', at });
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); };
function open(messages: Msg[], workspace = '/w/proj') {
  update(s => {
    s.convs = [{ id: 'c1', title: 't', remote: true, workspace, messages } as never];
    s.activeConv = 'c1'; s.route = { name: 'chat' } as never;
  });
}

beforeEach(() => {
  Object.assign(S, initialState()); S.homeDir = '/Users/me'; resetSnapshot(); mock.api.mockReset();
  compare = { staged: [], unstaged: [row('before.ts', 'modify')] };
  mock.api.mockImplementation(async (_m: string, path: string) => path.endsWith('/init') ? { mode: 'git-repo', branch: 'main' } : compare);
  startTurnBaseline();
});
afterEach(() => stopTurnBaseline());

it('WS-SNAPSHOT-02 #402 sending a message records the file state at the start of the turn', async () => {
  open([]);
  update(s => { s.convs[0].messages.push(user('u1')); });
  await flush();
  expect(S.turnBase.c1).toMatchObject({ msgId: 'u1', workspace: '/w/proj', status: 'ready', files: { '/w/proj/before.ts': 'modify' } });
});

it('WS-SNAPSHOT-02 #402 opening an old conversation or switching to it records nothing', async () => {
  open([user('old', Date.now() - 10 * 60_000)]);
  await flush();
  expect(S.turnBase.c1).toBeUndefined();
  expect(mock.api).not.toHaveBeenCalled();
});

it('WS-SNAPSHOT-02 #402 one message is recorded once however often the store changes', async () => {
  open([]);
  update(s => { s.convs[0].messages.push(user('u1')); });
  await flush();
  update(s => { s.prefs = { ...s.prefs }; });
  update(s => { s.prefs = { ...s.prefs }; });
  await flush();
  expect(mock.api.mock.calls.filter(c => c[1].endsWith('/compare'))).toHaveLength(1);
});

it('WS-SNAPSHOT-02 #402 a broad folder is recorded as skipped, without touching the core', async () => {
  open([], '/Users/me');
  update(s => { s.convs[0].messages.push(user('u1')); });
  await flush();
  expect(S.turnBase.c1).toMatchObject({ msgId: 'u1', status: 'skipped' });
  expect(mock.api).not.toHaveBeenCalled();
});

it('WS-SNAPSHOT-02 #402 a failed recording is kept as failed with its reason', async () => {
  mock.api.mockRejectedValue(Object.assign(new Error('快照失败'), { code: 'FILE_INTERNAL' }));
  open([]);
  update(s => { s.convs[0].messages.push(user('u1')); });
  await flush();
  expect(S.turnBase.c1).toMatchObject({ status: 'failed', code: 'FILE_INTERNAL' });
});

const change = (relative: string, operation: 'create' | 'modify' | 'delete') => ({ path: `/w/proj/${relative}`, relative, operation, staged: false });
const base = (files: Record<string, 'create' | 'modify' | 'delete'>) => ({ msgId: 'u1', workspace: '/w/proj', at: 1, status: 'ready' as const, files });

it('WS-SNAPSHOT-02 #402 turn changes are what differs from the state recorded at the start', () => {
  const now = [change('before.ts', 'modify'), change('added.ts', 'create'), change('flipped.ts', 'delete'), change('same.ts', 'modify')];
  const start = base({ '/w/proj/before.ts': 'modify', '/w/proj/flipped.ts': 'modify', '/w/proj/same.ts': 'modify' });
  expect(turnChangesFromBase(now, start, []).map(c => c.relative)).toEqual(['added.ts', 'flipped.ts']);
});

it('WS-SNAPSHOT-02 #402 a file the tools wrote this turn is kept even when its status did not change', () => {
  const now = [change('before.ts', 'modify'), change('other.ts', 'modify')];
  const start = base({ '/w/proj/before.ts': 'modify', '/w/proj/other.ts': 'modify' });
  expect(turnChangesFromBase(now, start, [{ path: 'before.ts', add: 1, del: 0 }]).map(c => c.relative)).toEqual(['before.ts']);
  expect(turnChangesFromBase(now, start, [{ path: '/w/proj/other.ts', add: 1, del: 0 }]).map(c => c.relative)).toEqual(['other.ts']);
});
