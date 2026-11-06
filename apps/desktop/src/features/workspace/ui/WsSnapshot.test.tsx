import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import { initialState } from '@/state/state';

const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', async original => ({ ...await original<typeof import('@/core/client')>(), api: mock.api }));
import { resetSnapshot } from '../runtime/snapshot';
import { WsChanges } from './WsActivity';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const row = (relative: string, operation: string) => ({ file_path: `/w/proj/${relative}`, relative_path: relative, operation });
let compare: unknown;
beforeEach(async () => {
  Object.assign(S, initialState()); S.homeDir = '/Users/me'; S.folder = '/w/proj'; resetSnapshot();
  S.convs = [{ id: 'c1', title: 't', messages: [{ id: 'u', type: 'user', at: 1 }, { id: 'f', type: 'files', at: 2, changes: [{ path: 'inferred.ts', add: 3, del: 0 }] }] } as never];
  S.activeConv = 'c1'; S.route = { name: 'chat' } as never;
  compare = { staged: [], unstaged: [row('real.ts', 'modify'), row('new.md', 'create'), row('old.css', 'delete')] };
  mock.api.mockReset();
  mock.api.mockImplementation(async (_m: string, path: string) => path.endsWith('/init') ? { mode: 'git-repo', branch: 'main' } : compare);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<WsChanges />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('WS-SNAPSHOT-01 #402 the changes page lists the real file state with the baseline it is measured against', () => {
  const text = host.textContent ?? '';
  expect(text).toContain('real.ts'); expect(text).toContain('new.md'); expect(text).toContain('old.css');
  expect(text).toContain('新增'); expect(text).toContain('修改'); expect(text).toContain('删除');
  expect(text).toContain('Git 仓库'); expect(text).toContain('main');
});

it('WS-SNAPSHOT-01 #402 the inferred per-turn list stays separate and still says it is inferred', () => {
  const inferred = host.querySelector('[aria-label="本轮工具调用（推断）"]');
  expect(inferred?.textContent).toContain('inferred.ts');
  expect(inferred?.textContent).toContain('根据工具调用推断');
  expect(host.querySelector('[aria-label="真实文件状态"]')?.textContent).not.toContain('inferred.ts');
});

it('WS-SNAPSHOT-01 #402 a core failure shows the error and a retry instead of an empty list', async () => {
  mock.api.mockRejectedValue(Object.assign(new Error('快照失败'), { code: 'FILE_INTERNAL' }));
  await act(async () => update(s => { s.folder = '/w/other'; }));
  expect(host.textContent).toContain('快照失败');
  expect(host.textContent).toContain('FILE_INTERNAL');
  expect([...host.querySelectorAll('button')].some(b => b.textContent === '重试')).toBe(true);
});

it('WS-SNAPSHOT-01 #402 a clean workspace says it matches the baseline', async () => {
  compare = { staged: [], unstaged: [] };
  await act(async () => update(s => { s.folder = '/w/clean'; }));
  expect(host.querySelector('[aria-label="真实文件状态"]')?.textContent).toContain('没有变更');
});

it('WS-SNAPSHOT-01 #402 a broad folder waits for the user before building a snapshot', async () => {
  mock.api.mockClear();
  await act(async () => update(s => { s.folder = '/Users/me'; }));
  expect(mock.api).not.toHaveBeenCalled();
  const button = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('建立快照'));
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(mock.api).toHaveBeenCalledWith('POST', '/api/fs/snapshot/init', { workspace: '/Users/me' });
});
