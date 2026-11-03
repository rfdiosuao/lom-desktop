import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/features/chat/ui/Chat', () => ({ useStickBottom: () => ({ ref: undefined, onScroll: vi.fn() }) }));
vi.mock('@/features/chat/ui/Composer', () => ({ Composer: () => <div data-testid="composer" /> }));
vi.mock('@/features/chat/ui/MessageList', () => ({ MessageList: () => null }));
vi.mock('@/features/chat/ui/ReplyPending', () => ({ ReplyPending: () => null }));
vi.mock('../activity/TeamActivityView', () => ({ TeamActivityView: () => <div data-testid="board" /> }));
vi.mock('@/features/workspace/runtime/workspace', () => ({ refreshWorkspace: vi.fn(), activeFolder: () => '' }));
import { TeamPage } from './TeamPage';
import { TeamModal } from './TeamModal';
import { DesktopSidebar } from '@/app/shell/Sidebars';
import { addMember, newTeam, pickAssist } from '../actions/teams';
import { closeModal } from '@/shared/overlays/controller';
import { S, update } from '@/state/store';
import { initialState } from '@/state/state';
import type { TeamMember } from '@/state/types';

/* UI-AUDIT-04：团队页的成员选择、停止按钮、悬停提示与无障碍名称。 */

let host: HTMLDivElement, root: Root;
const render = async (ui: ReactNode) => { await act(async () => root.render(ui)); };
const agents = () => (S.form.members as TeamMember[]).map(m => m.agent);
const stopButton = () => [...host.querySelectorAll<HTMLButtonElement>('.team__bar button')].find(b => b.textContent === '停止团队')!;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(S, initialState(true));
  S.agentCatalog = [];
  S.route = { name: 'team', id: S.teams[0].id }; S.teamView = 'side';
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); });

it('UI-AUDIT-04 F-04 Lom joins a team only once while other assistants can still be picked again', async () => {
  newTeam();
  pickAssist('pc'); pickAssist('pc');
  expect(agents()).toEqual(['pc']);
  expect(S.toast?.text).toBe('团队里已经有 Lom 了：Lom 只能加入一次，其他助手可以重复添加');
  pickAssist('p1'); pickAssist('p1');
  expect(agents()).toEqual(['pc', 'p1', 'p1']);
  await render(<TeamModal p={{ mode: 'create' }} />);
  expect(host.querySelector('.picker__hint')?.textContent).toBe('第一个加入的电脑 Agent 默认担任 Leader；后加入的作为成员。手机作为执行成员。');

  // 管理成员：已有 Lom 的团队不能再加一个；示例团队原有成员不动
  closeModal(true); addMember(S.teams[0].id);
  const before = agents();
  pickAssist('pc');
  expect(agents()).toEqual(before);
});

it('UI-AUDIT-04 F-07 member rows name the member on their Leader and 移除 buttons', async () => {
  newTeam(); pickAssist('pc'); pickAssist('p1');
  await render(<TeamModal p={{ mode: 'create' }} />);
  expect([...host.querySelectorAll('.member-row button[aria-label]')].map(b => b.getAttribute('aria-label')))
    .toEqual(['取消 Leader：Lom（总编）', '移除 Lom（总编）', '移除 手机一号（美妆运营）']);
});

it('UI-AUDIT-04 F-08 停止团队 is unavailable only for demo or never-started teams, with a visible reason', async () => {
  const note = () => host.querySelector('.team__stop-note');
  await render(<TeamPage />);
  expect(stopButton().disabled).toBe(true);
  expect(note()?.textContent).toBe('示例团队没有真实运行，不能停止');
  expect(stopButton().getAttribute('aria-describedby')).toBe(note()?.id);

  const team = S.teams[0]; team.real = true;
  await render(<TeamPage />);
  expect(stopButton().disabled).toBe(true);
  expect(note()?.textContent).toBe('团队还没有开工，没有可停止的任务');

  // 开工后本地看起来都空闲（重启后运行标记未恢复、内核成员没有本地会话）也仍可停止
  team.leaderConv = 'lead';
  S.convs = [{ id: 'lead', owner: 'pc', title: '小红书内容工厂', updated: 1, messages: [], teamId: team.id }];
  await render(<TeamPage />);
  expect(stopButton().disabled).toBe(false);
  expect(note()).toBeNull();
  expect(stopButton().hasAttribute('aria-describedby')).toBe(false);
  expect(stopButton().title).toBe('停止团队里可能仍在运行的任务；没有在运行时会告诉你');

  await act(async () => update(s => { s.running.lead = true; }));
  expect(stopButton().disabled).toBe(false);
  expect(stopButton().title).toBe('停止团队所有成员正在运行的任务');
});

it('UI-AUDIT-04 F-08 a core team without a local leader conversation can still be stopped', async () => {
  const team = S.teams[0]; team.real = true; team.leaderConv = undefined;
  team.core = { id: 'core-1', assistant: 'as-1', slots: {} };
  await render(<TeamPage />);
  expect(stopButton().disabled).toBe(false);
});

it('UI-AUDIT-04 F-07 member tabs carry full-name tooltips and the team bar groups are named', async () => {
  S.teams[0].members.push({ mid: 'm5', agent: 'ag:codex', role: '编程' });
  await render(<TeamPage />);
  expect([...host.querySelectorAll<HTMLButtonElement>('.team__members > button')].map(b => b.title))
    .toEqual(['电脑主控 · 总编', '手机一号 · 美妆运营', '手机二号 · 数码运营', '电脑主控 · 视觉设计', '本机 Agent · 编程']);
  const strip = host.querySelector('.team__members')!;
  expect(strip.getAttribute('role')).toBe('group');
  expect(strip.getAttribute('aria-label')).toBe('团队成员');
  expect(host.querySelector('.team__bar [role="radiogroup"]')?.getAttribute('aria-label')).toBe('团队视图');
});

it('UI-AUDIT-04 F-07 sidebar team rows show the full team name on hover', async () => {
  S.teams[0].name = '一个名字很长、在侧栏里会被截断的内容团队';
  await render(<DesktopSidebar />);
  const row = [...host.querySelectorAll<HTMLButtonElement>('.nav-item')].find(b => b.textContent?.includes('一个名字很长'))!;
  expect(row.title).toBe('一个名字很长、在侧栏里会被截断的内容团队');
});

it('TEAM-LEADER-01 AC1 first computer Agent stays leader when Lom joins later', async () => {
  const { createTeam, removeAssist } = await import('../actions/teams');
  S.agentCatalog = [{ id: 'ext', name: 'External', backend: 'codex', installed: true, status: 'online', enabled: true, agent_type: 'acp', agent_source: 'builtin' }];
  localStorage.setItem('lom.agent-options:ext', '[]');
  newTeam(); pickAssist('ag:ext'); pickAssist('pc');
  expect(S.form.members.map((m: {leader:boolean}) => !!m.leader)).toEqual([true, false]);
  S.form.name = '首位主控'; createTeam();
  expect(S.teams[0].members[0]).toMatchObject({agent:'ag:ext', leader:true});
  expect(S.teams[0].members).toHaveLength(2);
  localStorage.setItem('lom.agent-options:ext', '[]');
  newTeam(); pickAssist('ag:ext'); pickAssist('pc');
  removeAssist(S.form.members[0].mid);
  expect(S.form.members[0]).toMatchObject({agent:'pc', leader:true});
});

it('TEAM-LEADER-01 AC1 external-only team does not silently gain Lom; phones cannot be primary', async () => {
  const { createTeam } = await import('../actions/teams');
  S.agentCatalog = [{ id: 'ext', name: 'External', backend: 'codex', installed: true, status: 'online', enabled: true, agent_type: 'acp', agent_source: 'builtin' }];
  localStorage.setItem('lom.agent-options:ext', '[]');
  newTeam(); pickAssist('ag:ext'); S.form.name = '外部主控'; createTeam();
  expect(S.teams[0].members.map(m => m.agent)).toEqual(['ag:ext']);
  const count = S.teams.length;
  newTeam(); pickAssist('p1'); S.form.name = '手机'; createTeam();
  expect(S.teams).toHaveLength(count);
  expect(S.toast?.text).toContain('电脑 Agent');
});
