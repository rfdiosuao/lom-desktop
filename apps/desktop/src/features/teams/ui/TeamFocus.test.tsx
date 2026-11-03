import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TeamMailboxMessage, TeamTask } from '../activity/activityTypes';

/* TEAM-FOCUS-01：顶栏成员标签定位到看板列 / 并排窗格；看板建议和空状态把成员的输入框带出来。 */

const feed = vi.hoisted(() => ({ messages: [] as TeamMailboxMessage[], tasks: [] as TeamTask[], isLoading: false, isLoadingMore: false, hasMore: false, error: '', retry: vi.fn(), loadMore: vi.fn() }));
vi.mock('../activity/useTeamActivityFeed', () => ({ useTeamActivityFeed: () => feed }));
vi.mock('@/features/chat/ui/Chat', () => ({ useStickBottom: () => ({ ref: undefined, onScroll: vi.fn() }) }));
vi.mock('@/features/chat/ui/MessageList', () => ({ MessageList: () => null }));
vi.mock('@/features/chat/ui/ReplyPending', () => ({ ReplyPending: () => null }));
vi.mock('@/features/workspace/runtime/workspace', () => ({ refreshWorkspace: vi.fn(), activeFolder: () => '' }));
import { TeamPage } from './TeamPage';
import { createTeam } from '../actions/teams';
import { S } from '@/state/store';
import { initialState } from '@/state/state';

let host: HTMLDivElement, root: Root;
let scrolled: { el: Element; options: ScrollIntoViewOptions }[] = [];
let reduceMotion = false;
const originalScroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
const render = async () => { await act(async () => root.render(<TeamPage />)); };
const chips = () => [...host.querySelectorAll<HTMLButtonElement>('.team__members > button')];
const columns = () => [...host.querySelectorAll<HTMLElement>('[data-testid="activity-board-column"]')];
const column = (mid: string) => columns().find(c => c.dataset.memberId === mid);
const click = async (el: HTMLElement) => { await act(async () => el.click()); };

/** 已开工的真实团队：Lom Leader、真实手机、两个本机 Agent；手机列排在第二个，和顶栏成员顺序一致。 */
function startedTeam() {
  const team = S.teams[0];
  S.cloud = 'signed-in'; S.account = { id: 'account' } as typeof S.account;
  S.agents.p1.real = true;
  team.real = true;
  team.members = [
    { mid: 'm1', agent: 'pc', role: '总编', leader: true },
    { mid: 'm2', agent: 'p1', role: '美妆运营' },
    { mid: 'm3', agent: 'ag:codex', role: '编程' },
    { mid: 'm4', agent: 'ag:kimi', role: '看视频' },
  ];
  team.core = { id: 'core-team', assistant: 'leader', slots: { m1: 'lead', m3: 'codex', m4: 'kimi' } };
  S.teamView = 'board'; S.teamFocus = 'm1';
  return team;
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(S, initialState(true));
  S.route = { name: 'team', id: S.teams[0].id }; S.teamFocus = 'm1';
  scrolled = []; reduceMotion = false;
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value(this: Element, options: ScrollIntoViewOptions) { scrolled.push({ el: this, options }); } });
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: (query: string) => ({ matches: reduceMotion && query.includes('reduce'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  if (originalScroll) Object.defineProperty(Element.prototype, 'scrollIntoView', originalScroll);
  else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  delete (window as { matchMedia?: unknown }).matchMedia;
});

it('TEAM-FOCUS-01 AC-1 a board chip marks and scrolls to that member column, smoothly only without reduced motion', async () => {
  startedTeam(); await render();
  expect(column('m1')?.getAttribute('aria-current')).toBe('true');
  await click(chips()[2]);
  const target = column('m3')!;
  expect(target.getAttribute('aria-current')).toBe('true');
  expect(target.classList.contains('is-focus')).toBe(true);
  expect(columns().filter(c => c.getAttribute('aria-current') === 'true')).toEqual([target]);
  expect(chips()[2].getAttribute('aria-pressed')).toBe('true');
  expect(scrolled).toEqual([{ el: target, options: { block: 'nearest', inline: 'nearest', behavior: 'smooth' } }]);
  reduceMotion = true;
  await click(chips()[3]);
  expect(scrolled[1]).toEqual({ el: column('m4'), options: { block: 'nearest', inline: 'nearest', behavior: 'auto' } });
  expect(S.toast).toBeNull();
});

it('TEAM-FOCUS-01 AC-2 a side-view chip scrolls that member pane into view with a visible marker', async () => {
  S.teamView = 'side'; await render();
  await click(chips()[3]);
  const pane = host.querySelector<HTMLElement>('.pane[data-member-id="m4"]')!;
  expect(pane.classList.contains('is-focus')).toBe(true);
  expect(pane.getAttribute('aria-current')).toBe('true');
  expect(host.querySelectorAll('.pane[aria-current="true"]')).toHaveLength(1);
  expect(scrolled.map(x => x.el)).toEqual([pane]);
});

it('UI-AUDIT-04 AC-6 TEAM-FOCUS-01 only the team view is searched, so a same-id element elsewhere is not scrolled', async () => {
  const stray = document.createElement('div'); stray.dataset.memberId = 'm4'; document.body.prepend(stray);
  try {
    S.teamView = 'side'; await render();
    await click(chips()[3]);
    expect(scrolled.map(x => x.el)).toEqual([host.querySelector('.pane[data-member-id="m4"]')]);
  } finally { stray.remove(); }
});

it('TEAM-FOCUS-01 AC-3 a member without a board column gets an honest notice and no scroll', async () => {
  const team = startedTeam(); team.core = undefined; await render();
  await click(chips()[2]);
  expect(S.teamFocus).toBe('m3');
  expect(scrolled).toEqual([]);
  expect(S.toast?.text).toBe('这位成员开工后才会出现在看板上');

  // 示例团队里第二位 Lom 与 Leader 共用会话，示例手机不会有看板列
  Object.assign(S, initialState(true)); S.route = { name: 'team', id: S.teams[0].id }; S.teamView = 'board';
  await render();
  await click(chips()[3]);
  expect(S.toast?.text).toBe('这位成员与 Leader 共用会话，活动显示在 Leader 一列');
  await click(chips()[1]);
  expect(S.toast?.text).toBe('示例手机不会出现在看板上');
  expect(scrolled).toEqual([]);
});

it('TEAM-FOCUS-01 AC-3 a column hidden by the board member filter is reported as filtered, not missing', async () => {
  startedTeam(); await render();
  await click(host.querySelector<HTMLButtonElement>('.act-bar__chip[title="Lom"]')!);
  expect(columns().map(c => c.dataset.memberId)).toEqual(['m1']);
  await click(chips()[2]);
  expect(scrolled).toEqual([]);
  expect(S.toast?.text).toBe('看板正在读取或已按成员筛选，暂时看不到这位成员的一列');
});

it('TEAM-FOCUS-01 AC-4 board columns follow the top-bar member order, phone members included', async () => {
  startedTeam(); await render();
  expect(columns().map(c => c.dataset.memberId)).toEqual(['m1', 'm2', 'm3', 'm4']);
  for (const [index, mid] of ['m1', 'm2', 'm3', 'm4'].entries()) {
    await click(chips()[index]);
    expect(columns().filter(c => c.getAttribute('aria-current') === 'true').map(c => c.dataset.memberId)).toEqual([mid]);
    expect(scrolled.at(-1)?.el).toBe(column(mid));
  }
});

it('TEAM-FOCUS-01 AC-5 a board suggestion opens that member in single view with the text in its focused composer', async () => {
  startedTeam(); S.teamFocus = 'm3'; await render();
  await click(column('m1')!.querySelector<HTMLButtonElement>('[data-testid="team-empty-suggestion-debate"]')!);
  expect(S.teamView).toBe('single'); expect(S.teamFocus).toBe('m1');
  expect(host.querySelectorAll('.pane')).toHaveLength(1);
  const box = host.querySelector<HTMLTextAreaElement>('.pane[data-member-id="m1"] textarea')!;
  expect(box.value).toBe('组织一场辩论赛，让成员分别站在正方和反方');
  expect(document.activeElement).toBe(box);
});

it('TEAM-FOCUS-01 AC-6 the empty board offers 和 Leader 说目标, which opens the Leader composer', async () => {
  S.teamView = 'board'; S.teamFocus = 'm3'; await render();
  expect(host.textContent).toContain('团队还没有开工');
  expect(host.textContent).not.toContain('切换到成员会话');
  await click([...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '和 Leader 说目标')!);
  expect(S.teamView).toBe('single'); expect(S.teamFocus).toBe('m1');
  const box = host.querySelector<HTMLTextAreaElement>('.pane[data-member-id="m1"] textarea')!;
  expect(document.activeElement).toBe(box);
});

it.each([['board', '点「和 Leader 说目标」开工'], ['side', '在 Leader 窗格里说目标即可开工'], ['single', '在 Leader 窗格里说目标即可开工']] as const)(
  'TEAM-FOCUS-01 AC-7 the create-team hint matches the %s view the user lands in', (view, hint) => {
    S.teamView = view; S.form = { name: '新团队', folder: '', members: [{ mid: 'new-lead', agent: 'pc', role: '主控', leader: true }], roles: {} };
    createTeam();
    expect(S.route).toMatchObject({ name: 'team' });
    expect(S.toast?.text).toBe(`团队「新团队」已创建，${hint}`);
  });
