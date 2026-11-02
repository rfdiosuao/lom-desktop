import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ watch: vi.fn(), feed: { messages: [], tasks: [], isLoading: false, isLoadingMore: false, hasMore: true, error: '', retry: vi.fn(), loadMore: vi.fn() } }));
vi.mock('@/features/phones/runtime/phoneChat', () => ({ watchPhone: m.watch }));
vi.mock('./useTeamActivityFeed', () => ({ useTeamActivityFeed: () => m.feed }));
import { TeamActivityView } from './TeamActivityView';
import { S, update } from '@/state/store';
import { initialState } from '@/state/state';
import { beginAuthChange } from '@/features/account/runtime/authScope';
let host: HTMLDivElement, root: Root;
const render = async () => { await act(async () => root.render(<TeamActivityView team={S.teams[0]} />)); };
beforeEach(() => {
  vi.useFakeTimers(); m.watch.mockReset(); m.feed.error = ''; m.feed.isLoading = false;
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(S, initialState()); S.cloud = 'signed-in'; S.account = { id: 'account' } as typeof S.account;
  S.agents.dev_phone = { id: 'dev_phone', kind: 'phone', name: '测试手机', persona: '', status: 'online', real: true };
  const team = S.teams[0]; team.real = true; team.members = [{ mid: 'mobile', agent: 'dev_phone', role: '手机' }]; team.core = undefined;
  S.convs = [{ id: 'exact-conv', owner: 'dev_phone', phoneSession: 'session', teamId: team.id, title: '历史任务', updated: 2, loaded: true, messages: [{ id: 'reply', type: 'assistant', at: 1, text: '真实手机回复'.repeat(80) }] }];
  team.memberConvs = { mobile: 'exact-conv' }; S.running['exact-conv'] = true;
  S.route = { name: 'team', id: team.id }; S.teamView = 'board';
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
it('PHONE-TEAM-01 renders a phone-only team with real cards and no composer, receipt or core pagination', async () => {
  await render();
  expect(host.querySelectorAll('[data-testid="activity-board-column"]')).toHaveLength(1);
  expect(host.textContent).toContain('测试手机'); expect(host.textContent).toContain('在线'); expect(host.textContent).toContain('执行中');
  expect(host.querySelectorAll('[data-testid="activity-phone-card"]')).toHaveLength(2);
  expect(host.textContent).not.toContain('已读'); expect(host.querySelector('textarea')).toBeNull();
  expect(host.querySelector('[data-testid="activity-load-sentinel"]')).toBeNull();
});
it('PHONE-TEAM-01 clicking/Enter opens the exact phone conversation, never latest unrelated session', async () => {
  await render();
  await act(async () => host.querySelector<HTMLElement>('[data-testid="activity-phone-card"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(S.activeConv).toBe('exact-conv'); expect(S.mode).toBe('phone'); expect(S.phoneId).toBe('dev_phone');
});
it('PHONE-TEAM-01 expanding content or revoking membership cannot navigate or send', async () => {
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>('.act-card__more')!.click());
  expect(S.route.name).toBe('team');
  S.teams[0].members = [];
  await act(async () => host.querySelector<HTMLElement>('[data-testid="activity-phone-card"]')!.click());
  expect(S.route.name).toBe('team');
});
it('PHONE-TEAM-01 core errors/loading never hide local phone activity and updates render immediately', async () => {
  m.feed.error = 'core unavailable'; m.feed.isLoading = true; await render();
  expect(host.textContent).toContain('core unavailable'); expect(host.textContent).toContain('真实手机回复');
  await act(async () => update(s => { s.agents.dev_phone.status = 'offline'; }));
  expect(host.textContent).toContain('离线 · 执行状态未知');
});
it('PHONE-TEAM-01 a desktop team still loading shows the loading state, not a flash of empty member columns', async () => {
  const team = S.teams[0];
  team.members = [{ mid: 'lead', agent: 'pc', role: 'Leader', leader: true }];
  team.core = { id: 'core1', slots: { lead: 'slot-lead' }, assistant: 'lead-assistant' };
  S.convs = [];
  m.feed.isLoading = true; await render();
  expect(host.textContent).toContain('正在读取团队活动');
  expect(host.querySelector('[data-testid="activity-board-column"]')).toBeNull();
  m.feed.isLoading = false; await render();
  expect(host.querySelectorAll('[data-testid="activity-board-column"]')).toHaveLength(1);
});
it('PHONE-TEAM-01 observes only authorized online mapped phone sessions and stops polling on auth change', async () => {
  await render(); expect(m.watch).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTime(15000)); expect(m.watch).toHaveBeenCalledTimes(2);
  S.agents.dev_phone.status = 'offline'; await act(async () => vi.advanceTimersByTime(15000)); expect(m.watch).toHaveBeenCalledTimes(2);
  S.agents.dev_phone.status = 'online'; beginAuthChange();
  await act(async () => vi.advanceTimersByTime(15000)); expect(m.watch).toHaveBeenCalledTimes(2);
});
