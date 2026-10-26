import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => ({ url: 'http://core', token: 't', defaultFolder: '/work', homeDir: '/home/me' }) }));
vi.mock('@/features/chat/ui/Chat', () => ({ useStickBottom: () => ({ ref: undefined, onScroll: vi.fn() }) }));
vi.mock('@/features/chat/ui/Composer', () => ({ Composer: () => <div data-testid="composer" /> }));
vi.mock('@/features/chat/ui/MessageList', () => ({ MessageList: () => null }));
vi.mock('@/features/chat/ui/ReplyPending', () => ({ ReplyPending: () => null }));
vi.mock('../activity/TeamActivityView', () => ({ TeamActivityView: () => <div data-testid="board" />, fillTeamDraft: vi.fn() }));
import { TeamPage } from './TeamPage';
import { S } from '@/state/store';
import { initialState } from '@/state/state';
import { go } from '@/app/navigation';
import { activeFolder, refreshWorkspace } from '@/features/workspace/runtime/workspace';

let root: Root, host: HTMLDivElement;
const tree = [{ name: '封面.png', full_path: '/home/me/Projects/团队/封面.png', is_dir: false }];
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(S, initialState());
  S.homeDir = '/home/me'; S.folder = '/work';
  S.teams[0].folder = '~/Projects/团队';
  m.api.mockReset();
  m.api.mockImplementation(async (_method: string, path: string, body?: { dir?: string }) => {
    if (path === '/api/fs/dir') return body?.dir === '/home/me/Projects/团队' ? tree : [];
    return null;
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); });

it('D33-UX-03 the team page shows the shared team folder in the files panel, not the home-page folder', async () => {
  go('team', S.teams[0].id);
  expect(activeFolder()).toBe('/home/me/Projects/团队');
  await refreshWorkspace();
  expect(S.files?.path).toBe('/home/me/Projects/团队');
  expect(S.files?.children?.map(c => c.name)).toEqual(['封面.png']);
  // 离开团队页回到首页，文件面板跟着换回首页选的文件夹
  go('home');
  await refreshWorkspace();
  expect(activeFolder()).toBe('/work');
  expect(S.files?.path).toBe('/work');
});

it('D33-UX-03 the folder button opens the files panel instead of only toasting the path', async () => {
  S.route = { name: 'team', id: S.teams[0].id };
  S.wsTab = 'preview';
  await act(async () => root.render(<TeamPage />));
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label^="团队文件"]')!.click());
  expect(S.wsTab).toBe('files');
  expect(S.toast).toBeFalsy();
});

it('D33-UX-03 the three view modes carry visible labels, and the board uses a column (kanban) icon', async () => {
  S.route = { name: 'team', id: S.teams[0].id };
  await act(async () => root.render(<TeamPage />));
  const modes = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  expect(modes.map(b => b.textContent)).toEqual(['并排', '看板', '单个']);
  const board = modes[1].querySelector('svg')!.innerHTML;
  expect(board.match(/<rect/g)).toHaveLength(3);
});

it('D33-UX-03 a folder that does not exist yet reads as "no files yet", not as a raw system error', async () => {
  m.api.mockRejectedValue(new Error("cannot resolve path '/home/me/Projects/团队': No such file or directory (os error 2)"));
  S.route = { name: 'team', id: S.teams[0].id };
  await refreshWorkspace();
  expect(S.filesError).toContain('这个文件夹还不存在');
  expect(S.filesError).not.toContain('os error');
  m.api.mockRejectedValue(new Error('permission denied'));
  await refreshWorkspace();
  expect(S.filesError).toBe('permission denied');
});
