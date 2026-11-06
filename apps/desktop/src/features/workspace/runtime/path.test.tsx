import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ api: vi.fn(), endpoint: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: m.endpoint }));
import { S } from '@/state/store';
import { initialState } from '@/state/state';
import { relPath } from '@/features/chat/runtime/tools';
import { WsChanges } from '../ui/WsActivity';
import { WsFiles } from '../ui/WsFiles';
import { activeFolder, openMessagePath, refreshWorkspace } from './workspace';
import { WS_FILE_MISSING } from './required';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const coreFailure = (message: string, code?: string) => Object.assign(new Error(message), code ? { code } : {});

beforeEach(() => {
  vi.clearAllMocks(); Object.assign(S, initialState());
  m.endpoint.mockReturnValue({ url: 'http://core', homeDir: '/home', defaultFolder: '/work' });
  S.route = { name: 'chat' }; S.folder = '/work';
  m.api.mockImplementation(async (_m: string, p: string) => p.endsWith('/metadata') ? {} : p.endsWith('/dir') ? [] : 'file content');
});

it('WS-PATH-01 #398 the workspace prefix is cut only at a path-segment boundary, including Windows paths', () => {
  expect(relPath('/Users/h/proj2/report.md', '/Users/h/proj')).toBe('/Users/h/proj2/report.md');
  expect(relPath('/Users/h/proj/a/b.md', '/Users/h/proj')).toBe('a/b.md');
  expect(relPath('/Users/h/proj/a/b.md', '/Users/h/proj/')).toBe('a/b.md');
  expect(relPath('C:\\proj2\\x.md', 'C:\\proj')).toBe('C:\\proj2\\x.md');
  expect(relPath('C:\\proj\\src\\x.md', 'C:\\proj')).toBe('src\\x.md');
  expect(relPath('c:\\Proj\\x.md', 'C:\\proj')).toBe('x.md');
  expect(relPath('/Users/h/proj', '/Users/h/proj')).toBe('proj');
});

async function renderChanges(workspace: string, paths: string[]) {
  S.convs = [{ id: 'c', owner: 'pc', remote: true, workspace, messages: [{ id: 'f', type: 'files', at: 0, changes: paths.map(path => ({ path, add: 1, del: 0 })) }] }] as never;
  S.activeConv = 'c';
  const host = document.createElement('div'); const root = createRoot(host);
  await act(async () => root.render(<WsChanges />));
  return { host, done: () => act(() => root.unmount()) };
}

it('WS-PATH-01 #398 clicking a change opens and reads the absolute path, not the shortened one', async () => {
  const { host, done } = await renderChanges('/Users/h/proj', ['docs/a.md', '/Users/h/proj2/report.md']);
  const rows = [...host.querySelectorAll<HTMLButtonElement>('.diff-row')];
  await act(async () => rows[0].click());
  expect(S.openFile).toBe('/Users/h/proj/docs/a.md');
  expect(m.api).toHaveBeenCalledWith('POST', '/api/fs/read', expect.objectContaining({ path: '/Users/h/proj/docs/a.md' }));
  await act(async () => rows[1].click());
  expect(S.openFile).toBe('/Users/h/proj2/report.md');
  await done();
});

it('WS-PATH-01 #398 a Windows workspace keeps its backslashes when a change is opened', async () => {
  const { host, done } = await renderChanges('C:\\proj', ['src\\a.md']);
  await act(async () => host.querySelector<HTMLButtonElement>('.diff-row')!.click());
  expect(S.openFile).toBe('C:\\proj\\src\\a.md');
  await done();
});

it('WS-PATH-01 #399 clicking a file path inside the workspace opens it without changing the workspace root', async () => {
  S.convs = [{ id: 'c', owner: 'pc', remote: true, workspace: '/work', messages: [] }] as never; S.activeConv = 'c';
  await openMessagePath('出品/index.html', '/work');
  expect(S.workspaceBrowseRoot).toBe('');
  expect(activeFolder()).toBe('/work');
  expect(S.openFile).toBe('/work/出品/index.html'); expect(S.openFileContent).toBe('file content');
  expect(S.treeOpen['/work/出品']).toBe(true);
});

it('WS-PATH-01 #399 a folder inside the workspace is revealed in the tree instead of becoming the root', async () => {
  S.convs = [{ id: 'c', owner: 'pc', remote: true, workspace: '/work', messages: [] }] as never; S.activeConv = 'c';
  m.api.mockImplementation(async (_m: string, p: string) => p.endsWith('/metadata') ? { is_directory: true } : []);
  await openMessagePath('/work/docs/deep', '/work');
  expect(activeFolder()).toBe('/work'); expect(S.files?.path).toBe('/work');
  expect(S.treeOpen['/work/docs']).toBe(true); expect(S.treeOpen['/work/docs/deep']).toBe(true);
});

it('WS-PATH-01 #399 a file outside the workspace is read on its own and the workspace root stays put', async () => {
  S.convs = [{ id: 'c', owner: 'pc', remote: true, workspace: '/work', messages: [] }] as never; S.activeConv = 'c';
  await openMessagePath('/elsewhere/out/a.md', '/work');
  expect(activeFolder()).toBe('/work');
  expect(m.api).toHaveBeenCalledWith('POST', '/api/fs/read', { path: '/elsewhere/out/a.md', workspace: '/elsewhere/out' });
  expect(S.openFileContent).toBe('file content');
});

it('WS-PATH-01 #399 a folder outside the workspace shows a way back to the workspace root', async () => {
  S.convs = [{ id: 'c', owner: 'pc', remote: true, workspace: '/work', messages: [] }] as never; S.activeConv = 'c';
  m.api.mockImplementation(async (_m: string, p: string) => p.endsWith('/metadata') ? { is_directory: true } : []);
  await openMessagePath('/elsewhere/out', '/work');
  expect(activeFolder()).toBe('/elsewhere/out');
  const host = document.createElement('div'); const root = createRoot(host);
  await act(async () => root.render(<WsFiles />));
  const back = [...host.querySelectorAll('button')].find(b => b.textContent === '返回工作区')!;
  expect(back).toBeDefined();
  await act(async () => back.click());
  expect(S.workspaceBrowseRoot).toBe(''); expect(activeFolder()).toBe('/work');
  act(() => root.unmount());
});

it.each([
  ['unix', coreFailure('No such file or directory (os error 2)')],
  ['windows os error 3', coreFailure('系统找不到指定的路径。 (os error 3)')],
  ['status code', Object.assign(new Error('x'), { code: 'HTTP_404', status: 404 })],
  ['error code', coreFailure('boom', 'ENOENT')],
])('WS-PATH-01 #404 a missing file (%s) says it does not exist yet, with a code and no raw system text', async (_n, error) => {
  S.convs = [{ id: 'c', owner: 'pc', remote: true, workspace: '/work', messages: [] }] as never; S.activeConv = 'c';
  const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  m.api.mockRejectedValue(error);
  await openMessagePath('/work/ghost.html', '/work');
  expect(S.openFile).toBe('/work/ghost.html');
  expect(S.openFileError).toContain(WS_FILE_MISSING); expect(S.openFileError).toContain('还不存在');
  expect(S.openFileError).not.toMatch(/os error|No such file|系统找不到/);
  expect(S.filesError).toBe('');
  log.mockRestore();
});

it('WS-PATH-01 #404 other open failures show a coded short message and keep the raw text out of the UI', async () => {
  S.convs = [{ id: 'c', owner: 'pc', remote: true, workspace: '/work', messages: [] }] as never; S.activeConv = 'c';
  const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  m.api.mockRejectedValue(coreFailure('disk exploded: EIO'));
  await openMessagePath('/work/a.md', '/work');
  expect(S.openFileError).toContain('workspace.open_failed'); expect(S.openFileError).not.toContain('EIO');
  expect(log).toHaveBeenCalled();
  log.mockRestore();
});

it('WS-PATH-01 #404 a Windows folder that does not exist yet is "no files yet", not a failure', async () => {
  m.api.mockRejectedValue(coreFailure('系统找不到指定的路径。 (os error 3)'));
  await refreshWorkspace();
  expect(S.filesError).toContain('这个文件夹还不存在');
  expect(S.filesError).not.toContain('os error');
});

it('WS-PATH-01 #407 switching folders drops the old tree at once and a missing root clears it', async () => {
  S.files = { name: 'a', path: '/a', type: 'dir', children: [{ name: 'x.md', path: '/a/x.md', type: 'file' }] };
  S.folder = '/b';
  let release!: (v: unknown[]) => void;
  m.api.mockImplementation(() => new Promise(r => { release = r as never; }));
  const pending = refreshWorkspace();
  expect(S.files).toBeNull(); expect(S.filesLoading).toBe(true);
  release([]); await pending;
  expect(S.files?.path).toBe('/b');
  S.folder = '';
  await refreshWorkspace();
  expect(S.files).toBeNull(); expect(S.filesError).toBe(''); expect(S.filesLoading).toBe(false);
});

it('WS-PATH-01 #407 the file tree only renders a tree that belongs to the current root', async () => {
  S.folder = '/b'; S.files = { name: 'a', path: '/a', type: 'dir', children: [{ name: 'stale.md', path: '/a/stale.md', type: 'file' }] };
  const host = document.createElement('div'); const root = createRoot(host);
  await act(async () => root.render(<WsFiles />));
  expect(host.textContent).not.toContain('stale.md');
  await act(async () => { S.folder = ''; root.render(<WsFiles />); });
  expect(host.textContent).toContain('还没有选择工作文件夹');
  act(() => root.unmount());
});
