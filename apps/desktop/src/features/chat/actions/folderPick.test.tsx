import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn(), toastError: vi.fn(), refresh: vi.fn() }));
vi.mock('@/core/client', () => ({
  api: m.api, getEndpoint: () => ({ url: 'http://core', token: 't', defaultFolder: '/work/default', homeDir: '/Users/me' }),
}));
vi.mock('@/shared/overlays/controller', async orig => ({ ...(await orig<object>()), toast: m.toast, toastError: m.toastError }));
vi.mock('@/features/workspace/runtime/workspace', async orig => ({ ...(await orig<object>()), refreshWorkspace: m.refresh }));
import { S } from '@/state/store';
import { initialState } from '@/state/state';
import type { Conv } from '@/state/types';
import { MENUS } from '@/app/overlays/menu-registry';
import { MenuHost } from '@/app/overlays/MenuHost';
import { WsFiles } from '@/features/workspace/ui/Workspace';
import { pickFolderPath } from './composer';

type Row = { label?: string; desc?: string; checked?: boolean; header?: boolean; onSelect?: () => void };
const rows = (items: unknown[]) => items.filter((i): i is Row => i !== '-') as Row[];
const toasts = () => m.toast.mock.calls.map(c => String(c[0])).join(' ');

let task: Conv;
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(S, initialState());
  task = { id: 't1', owner: 'pc', title: '任务', updated: 1, messages: [], remote: true, loaded: true, workspace: '/work/old' };
  S.convs = [task];
  S.folder = '/work/default';
  S.homeDir = '/Users/me';
  S.recentFolders = ['/work/default', '/work/other'];
  S.route = { name: 'chat' }; S.activeConv = 't1';
  m.api.mockResolvedValue({});
});

it('CW03 picking a folder in an open task saves it to that task and leaves the new-task default alone', async () => {
  await pickFolderPath('/work/other', 'conv:t1');
  expect(m.api).toHaveBeenCalledWith('PATCH', '/api/conversations/t1', { extra: { workspace: '/work/other' } });
  expect(task.workspace).toBe('/work/other');
  expect(S.folder).toBe('/work/default');
  expect(S.recentFolders[0]).toBe('/work/other');
  expect(m.refresh).toHaveBeenCalled();
});

it('CW03 tells the user that an already running Agent only works in the new folder after the task restarts', async () => {
  await pickFolderPath('/work/other', 'conv:t1');
  expect(toasts()).toContain('重启');
  expect(toasts()).toContain('other');
});

it('CW03 a failed save does not pretend the folder was changed', async () => {
  m.api.mockRejectedValue(new Error('core.rejected'));
  await pickFolderPath('/work/other', 'conv:t1');
  expect(task.workspace).toBe('/work/old');
  expect(S.recentFolders).toEqual(['/work/default', '/work/other']);
  expect(S.folder).toBe('/work/default');
  expect(m.toastError).toHaveBeenCalledWith('更换工作文件夹失败', expect.any(Error));
  expect(m.toast).not.toHaveBeenCalled();
  expect(m.refresh).not.toHaveBeenCalled();
});

it('CW03 on the new-task page the pick only changes the default folder and calls no task API', async () => {
  await pickFolderPath('/work/other');
  expect(S.folder).toBe('/work/other');
  expect(m.api).not.toHaveBeenCalled();
  expect(task.workspace).toBe('/work/old');
});

it('CW03 the plus menu shows the task folder, and the folder submenu checks it even when it is not a recent folder', () => {
  const attach = rows(MENUS.attach({ ckey: 'conv:t1' })).find(i => i.label === '工作文件夹');
  expect(attach?.desc).toBe('/work/old');

  const menu = rows(MENUS.folder({ ckey: 'conv:t1' }));
  expect(menu[0]).toMatchObject({ header: true, label: '这个任务的工作文件夹' });
  const checked = menu.filter(i => i.checked);
  expect(checked.map(i => i.desc)).toEqual(['/work/old']);
  expect(menu.some(i => i.label === 'other' && !i.checked)).toBe(true);

  // 新任务页仍然看全局默认文件夹
  const home = rows(MENUS.folder({}));
  expect(home[0]).toMatchObject({ header: true, label: '总指挥的工作文件夹' });
  expect(home.filter(i => i.checked).map(i => i.desc)).toEqual(['/work/default']);
});

it('CW03 choosing a folder from the submenu writes it to the task it was opened for', async () => {
  const other = rows(MENUS.folder({ ckey: 'conv:t1' })).find(i => i.label === 'other')!;
  await act(async () => { other.onSelect!(); });
  expect(m.api).toHaveBeenCalledWith('PATCH', '/api/conversations/t1', { extra: { workspace: '/work/other' } });
  expect(task.workspace).toBe('/work/other');
});

let host: HTMLDivElement, root: Root;
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); });

it('CW03 the folder name in the workspace pane of a running task opens the same menu and saves to that task', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<><WsFiles /><MenuHost /></>));

  const button = host.querySelector<HTMLButtonElement>('button[title^="这个任务的工作文件夹"]');
  expect(button).not.toBeNull();
  await act(async () => button!.click());

  const items = [...host.querySelectorAll<HTMLElement>('.menu__item')];
  expect(items.length).toBeGreaterThan(0);
  expect(host.textContent).toContain('这个任务的工作文件夹');
  await act(async () => items.find(x => x.textContent?.startsWith('other'))!.click());

  expect(m.api).toHaveBeenCalledWith('PATCH', '/api/conversations/t1', { extra: { workspace: '/work/other' } });
  expect(task.workspace).toBe('/work/other');
});
