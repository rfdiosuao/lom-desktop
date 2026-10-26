import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initialState } from '@/state/state';
import { S, update } from '@/state/store';
import { DesktopSidebar } from '@/app/shell/Sidebars';
import { MenuHost } from '@/app/overlays/MenuHost';
import { pickAgent } from '@/features/settings/actions/agents';
import { openAgentHistory } from '@/features/chat/actions/history';
import { goBack, goFwd, newTask, openConv } from '@/app/navigation';
import { historyAgentId } from '@/state/history';
import type { AgentRow } from '@/features/settings/runtime/agents';

vi.mock('@/features/chat/runtime/tasks', () => ({ openTask: vi.fn() }));
vi.mock('@/features/settings/runtime/agentOptions', () => ({ loadConvOptions: vi.fn(), cachedOptions: vi.fn(), modelOption: vi.fn(), probeAgentOptions: vi.fn() }));
vi.mock('@/features/workspace/runtime/workspace', () => ({ refreshWorkspace: vi.fn(), activeFolder: () => '' }));
let host: HTMLDivElement, root: Root;
const agent = (id: string, name: string): AgentRow => ({ id, name, icon: `/icons/${id}.svg`, installed: true, enabled: true, status: 'online', agent_type: 'acp', agent_source: 'external' });
const click = async (selector: string) => { await act(async () => host.querySelector<HTMLButtonElement>(selector)!.click()); };
const titles = () => [...host.querySelectorAll('.conv__title')].map(x => x.textContent);
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); Object.assign(S, initialState());
  S.conn = 'ready'; S.agentCatalog = [agent('codex', 'Codex CLI'), agent('claude', 'Claude Code')]; S.agentPins = ['codex', 'claude'];
  S.convs = [
    { id: 'lom', title: 'Lom 历史', owner: 'pc', updated: 1, messages: [] },
    { id: 'c1', title: 'Codex 正在工作', owner: 'pc', agentId: 'codex', updated: 3, messages: [] },
    { id: 'c2', title: 'Codex 较早会话', owner: 'pc', agentId: 'codex', updated: 2, messages: [] },
    { id: 'team', title: '团队会话', owner: 'pc', teamId: 'team', updated: 4, messages: [] },
    { id: 'side', title: '侧边会话', owner: 'pc', sideOf: 'lom', updated: 4, messages: [] },
    { id: 'phone', title: '手机会话', owner: 'p1', updated: 4, messages: [] },
  ];
  S.teams = []; S.running = { c1: true, c2: true }; S.drafts = { home: '未发送', 'conv:lom': '保留草稿' };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<><DesktopSidebar /><MenuHost /></>));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('D27 AC-1: history picker filters without changing the current agent or conversation', async () => {
  expect(titles()).toEqual(['Lom 历史']);
  await click('.history-picker');
  const menuItem = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(x => x.textContent?.includes('Codex CLI'))!;
  expect(menuItem.textContent).toContain('2 个运行中');
  await act(async () => menuItem.click());
  expect(titles()).toEqual(['Codex 正在工作', 'Codex 较早会话']);
  expect(S.activeConv).toBeNull(); expect(S.agentPick).toBe('');
  expect(host.querySelector('.history-picker')?.textContent).toBe('');
  expect(host.querySelector('.history-picker')?.getAttribute('aria-label')).toBe('历史会话分类：Codex CLI');
  expect(host.querySelector('.history-heading__label')?.textContent).toBe('最近任务');
});
it('D27 AC-2: background agent rings transfer to individual conversation logos and clear on completion', async () => {
  expect(host.querySelectorAll('.history-heading .history-icon')).toHaveLength(1);
  expect(host.querySelectorAll('.history-picker .history-icon__ring')).toHaveLength(1);
  expect(host.querySelectorAll('.conv .history-icon__ring')).toHaveLength(0);
  await click('.history-picker');
  const codex = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(x => x.textContent?.includes('Codex CLI'))!;
  await act(async () => codex.click());
  expect(host.querySelectorAll('.conv .history-icon__ring')).toHaveLength(2);
  expect(host.querySelectorAll('.history-picker .history-icon__ring')).toHaveLength(0);
  await act(async () => update(s => { s.running.c1 = false; }));
  expect(host.querySelectorAll('.conv .history-icon__ring')).toHaveLength(1);
  await act(async () => update(s => { s.running.c2 = false; }));
  expect(host.querySelectorAll('.history-icon__ring')).toHaveLength(0);
});
it('D27 AC-2: status updates preserve mounted ring and image nodes instead of restarting animation', async () => {
  const ring = host.querySelector('.history-icon__ring'), image = ring?.parentElement?.querySelector('img');
  for (let i = 0; i < 8; i++) await act(async () => update(s => { s.convs[1].title = `流式更新 ${i}`; }));
  expect(host.querySelector('.history-icon__ring')).toBe(ring);
  expect(ring?.parentElement?.querySelector('img')).toBe(image);
});
it('D27 AC-3: browsing another agent preserves the open conversation, draft, preview and navigation', async () => {
  await act(async () => openConv('c1'));
  await act(async () => update(s => { s.openFile = '/tmp/example.md'; s.drafts['conv:c1'] = '正在编辑'; }));
  const before = { route: {...S.route}, back: [...S.back], fwd: [...S.fwd] };
  await act(async () => openAgentHistory('claude'));
  expect(historyAgentId()).toBe('claude'); expect(titles()).toEqual([]);
  expect(S.activeConv).toBe('c1'); expect(S.agentPick).toBe('codex');
  expect(S.route).toEqual(before.route); expect(S.back).toEqual(before.back); expect(S.fwd).toEqual(before.fwd);
  expect(S.openFile).toBe('/tmp/example.md'); expect(S.drafts['conv:c1']).toBe('正在编辑');
  expect(S.running).toEqual({ c1: true, c2: true });
});
it('D27 AC-3: clicking a history row opens it; navigation never overwrites the independent filter', async () => {
  await act(async () => openAgentHistory('codex'));
  await click('.conv__name');
  expect(S.activeConv).toBe('c1'); expect(S.agentPick).toBe('codex');
  await act(async () => openAgentHistory(''));
  await act(async () => newTask());
  expect(historyAgentId()).toBe(''); expect(S.agentPick).toBe('codex');
  await act(async () => goBack()); expect(S.activeConv).toBe('c1'); expect(historyAgentId()).toBe('');
  await act(async () => goFwd()); expect(S.route.name).toBe('home'); expect(historyAgentId()).toBe('');
});
it('D27 AC-3: the top agent selector does not change the history filter', async () => {
  await act(async () => openAgentHistory('codex'));
  await act(async () => pickAgent('claude'));
  expect(S.agentPick).toBe('claude'); expect(historyAgentId()).toBe('codex');
  expect(titles()).toEqual(['Codex 正在工作', 'Codex 较早会话']);
  expect(S.drafts.home).toBe('未发送');
});
it('D27 AC-3: opening an external result updates the chat agent but keeps the browsed history', async () => {
  await act(async () => openConv('c2'));
  expect(S.agentPick).toBe('codex'); expect(historyAgentId()).toBe(''); expect(titles()).toEqual(['Lom 历史']);
});
it('D27 AC-4: removed or offline agents retain readable history; import opens the real history dialog', async () => {
  await act(async () => update(s => { s.convs.push({ id: 'old', title: '旧会话', agentName: '旧 Agent', agentId: 'removed', owner: 'pc', messages: [], updated: 0 }); }));
  await click('.history-picker');
  const old = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(x => x.textContent?.includes('旧 Agent'))!;
  await act(async () => old.click()); expect(titles()).toEqual(['旧会话']);
  await click('.history-picker');
  const items = host.querySelectorAll<HTMLButtonElement>('.menu__item');
  expect(items[items.length - 1].textContent).toContain('导入会话历史');
  expect(items[items.length - 1].disabled).toBe(false);
  await act(async () => items[items.length - 1].click());
  expect(S.modals.at(-1)?.id).toBe('historyImport');
});
