import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/features/chat/runtime/tasks', () => ({ openTask: vi.fn() }));
vi.mock('@/features/settings/runtime/agentOptions', () => ({ loadConvOptions: vi.fn(), cachedOptions: vi.fn(), modelOption: vi.fn(), probeAgentOptions: vi.fn() }));
vi.mock('@/features/workspace/runtime/workspace', () => ({ refreshWorkspace: vi.fn(), activeFolder: () => '' }));
import { initialState } from '@/state/state';
import { S } from '@/state/store';
import { MenuHost } from '@/app/overlays/MenuHost';
import { DesktopSidebar } from './Sidebars';

/* TEAM-MENU-01：侧栏右键菜单——团队行与会话行右键打开各自的菜单；团队行也有悬停「⋯」。 */

let host: HTMLDivElement, root: Root;
const rightClick = async (el: Element) => {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
  await act(async () => { el.dispatchEvent(event); });
  return event;
};
const menuText = () => host.querySelector('.menu')?.textContent ?? '';
const teamRow = () => [...host.querySelectorAll<HTMLElement>('.team-row')].find(row => row.textContent?.includes('小红书内容工厂'))!;

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); Object.assign(S, initialState(true));
  S.agentCatalog = [];
  S.convs = [{ id: 'lom', title: '整理本周选题', owner: 'pc', updated: 1, messages: [] }];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<><DesktopSidebar /><MenuHost /></>));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('TEAM-MENU-01 AC-1 right-clicking a sidebar team row opens that team menu instead of the browser menu', async () => {
  const event = await rightClick(teamRow().querySelector('.nav-item')!);
  expect(event.defaultPrevented).toBe(true);
  expect(S.menu).toMatchObject({ id: 'team', ctx: { id: S.teams[0].id } });
  expect(menuText()).toContain('重命名团队');
  expect(menuText()).toContain('管理成员');
  expect(menuText()).toContain('导出为 Markdown');
  expect(menuText()).toContain('解散团队');
});

it('TEAM-MENU-01 AC-1 team rows also offer a 团队选项 button that opens the same menu', async () => {
  const more = teamRow().querySelector<HTMLButtonElement>('button[aria-label="团队选项"]')!;
  await act(async () => more.click());
  expect(S.menu).toMatchObject({ id: 'team', ctx: { id: S.teams[0].id, align: 'end' } });
  expect(menuText()).toContain('导出为 Markdown');
});

it('TEAM-MENU-01 AC-2 right-clicking a conversation row opens its conversation menu', async () => {
  const row = [...host.querySelectorAll<HTMLElement>('.conv')].find(x => x.textContent?.includes('整理本周选题'))!;
  const event = await rightClick(row.querySelector('.conv__name')!);
  expect(event.defaultPrevented).toBe(true);
  expect(S.menu).toMatchObject({ id: 'conv', ctx: { id: 'lom' } });
  expect(menuText()).toContain('重命名');
  expect(menuText()).toContain('导出为 Markdown');
});
