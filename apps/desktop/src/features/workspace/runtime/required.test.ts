import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => ({ url: 'http://core', homeDir: '/Users/me', defaultFolder: '/Users/me/Documents' }) }));
import { S } from '@/state/store';
import { initialState } from '@/state/state';
import { createTeamConfiguration } from '@/features/teams/runtime/configuration';
import { openFile, openFolderInSystem, openInSystem } from './workspace';
import { pathTitle, taskFolder, WS_FILE_MISSING, WS_FILE_OUTSIDE, WS_REQUIRED } from './required';

beforeEach(() => {
  vi.clearAllMocks(); Object.assign(S, initialState());
  S.route = { name: 'home' }; S.folder = '/Users/me/proj';
});

it('WS-REQUIRED-01 AC4 a dispatched or team session without a workspace fails with workspace.required, never the home default', () => {
  expect(() => taskFolder({ parent: 'p1' })).toThrow(WS_REQUIRED);
  expect(() => taskFolder({ team: 't1' })).toThrow(WS_REQUIRED);
  expect(taskFolder({ parent: 'p1', folder: '/Users/me/done' })).toBe('/Users/me/done');
});

it('WS-REQUIRED-01 AC4 a home task without any workspace fails with workspace.required and does not fall back to the core default folder', () => {
  S.folder = '';
  expect(() => taskFolder({})).toThrow(WS_REQUIRED);
});

it('WS-REQUIRED-01 AC4 creating a real team without a workspace is refused with a coded error and nothing is stored', () => {
  expect(() => createTeamConfiguration({ name: 'x', folder: '', members: [], real: true })).toThrow(WS_REQUIRED);
  expect(S.teams).toHaveLength(0);
  expect(createTeamConfiguration({ name: 'demo', folder: '', members: [], real: false }).name).toBe('demo');
  expect(createTeamConfiguration({ name: 'ok', folder: '/Users/me/t', members: [], real: true }).folder).toBe('/Users/me/t');
});

it('WS-REQUIRED-01 AC5 a file the core cannot find is reported as missing with its code, not shown as an empty file', async () => {
  m.api.mockResolvedValue(null);
  await openFile('/Users/me/proj/ghost.md');
  expect(S.openFileContent).toBe('');
  expect(S.openFileError).toContain(WS_FILE_MISSING);
  expect(S.openFileError).toContain('/Users/me/proj/ghost.md');
});

it('WS-REQUIRED-01 AC5 a file written outside the workspace says where it is and carries workspace.file_outside', async () => {
  m.api.mockRejectedValue(Object.assign(new Error('Path is outside the allowed sandbox.'), { code: 'PATH_OUTSIDE_SANDBOX' }));
  await openFile('/tmp/elsewhere/out.md');
  expect(S.openFileError).toContain(WS_FILE_OUTSIDE);
  expect(S.openFileError).toContain('/tmp/elsewhere/out.md');
  expect(S.openFileError).toContain('/Users/me/proj');
});

it('WS-REQUIRED-01 AC5 a normal file still opens', async () => {
  m.api.mockResolvedValue('hello');
  await openFile('/Users/me/proj/a.md');
  expect(S.openFileContent).toBe('hello');
  expect(S.openFileError).toBe('');
});

it('WS-REQUIRED-01 AC5 system open failure surfaces a coded error instead of being swallowed', async () => {
  m.api.mockRejectedValue(new Error('No such file'));
  await expect(openInSystem('/Users/me/proj/gone.md')).rejects.toThrow('workspace.shell_failed');
});

it('WS-REQUIRED-01 AC5 message path buttons say when the file is outside the workspace', () => {
  expect(pathTitle('/tmp/x.md', '/Users/me/proj')).toContain('工作区之外');
  expect(pathTitle('/Users/me/proj/x.md', '/Users/me/proj')).not.toContain('工作区之外');
  expect(pathTitle('src/x.md', '/Users/me/proj')).not.toContain('工作区之外');
});

it('WS-REQUIRED-01 AC6 an old task with no workspace does not borrow the home folder for its file panel', async () => {
  S.route = { name: 'chat' }; S.activeConv = 'old';
  S.convs = [{ id: 'old', owner: 'pc', title: '旧', updated: 1, messages: [], remote: true, loaded: true }];
  const { activeFolder } = await import('./workspace');
  expect(activeFolder()).toBe('');
});

it('WS-OPEN-FOLDER-01 opening a folder asks the core to open the folder itself, never the file-only open route', async () => {
  m.api.mockResolvedValue(null);
  await openFolderInSystem('/Users/me/proj');
  expect(m.api).toHaveBeenCalledWith('POST', '/api/shell/open-folder-with', { folder_path: '/Users/me/proj', tool: 'explorer' });
  expect(m.api).not.toHaveBeenCalledWith('POST', '/api/shell/open-file', expect.anything());
});

it('WS-OPEN-FOLDER-01 a folder the system cannot open surfaces workspace.shell_failed and names a folder, not a file', async () => {
  m.api.mockRejectedValue(new Error('directory not found'));
  const failure = await openFolderInSystem('/Users/me/gone').catch((e: Error) => e);
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toContain('workspace.shell_failed');
  expect((failure as Error).message).toContain('文件夹可能不存在');
});
