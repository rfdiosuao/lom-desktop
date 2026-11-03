import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TeamMailboxMessage, TeamTask } from './activityTypes';
const feed = vi.hoisted(() => ({ messages: [] as TeamMailboxMessage[], tasks: [] as TeamTask[], isLoading: false, isLoadingMore: false, hasMore: false, error: '', retry: vi.fn(), loadMore: vi.fn() }));
vi.mock('./useTeamActivityFeed', () => ({ useTeamActivityFeed: () => feed }));
import { TeamActivityView } from './TeamActivityView';
import { openTeamMember } from '../actions/teams';
import { S } from '@/state/store';
import { initialState } from '@/state/state';
let host: HTMLDivElement, root: Root, first: string, second: string;
beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(S, initialState(true));
  const team = S.teams[0]; [first, second] = team.members.map(m => m.mid);
  team.core = { id: 'core-team', assistant: 'leader', slots: { [first]: 'lead', [second]: 'worker' } };
  S.route = { name: 'team', id: team.id }; S.teamView = 'board';
  feed.messages = [{ id: 'message', team_id: 'core-team', from_agent_id: 'lead', to_agent_id: 'worker', msg_type: 'message', content: '任务说明'.repeat(100), summary: null, read: false, files: [], created_at: 1 }];
  feed.tasks = [{ id: 'task', team_id: 'core-team', subject: '任务', owner: 'worker', status: 'pending', blocked_by: ['dep'], blocks: [], created_at: 2, updated_at: 2 }];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<TeamActivityView team={team} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it.each(['message', 'task'])('D33-CARD-01 clicking %s enters its lane member conversation without creating or sending', async kind => {
  const conversations = S.convs.length; const drafts = { ...S.drafts };
  await act(async () => host.querySelector<HTMLElement>(`[data-testid="activity-${kind}-card"]`)!.click());
  expect(S.teamFocus).toBe(second); expect(S.teamView).toBe('single');
  expect(S.convs.length).toBe(conversations); expect(S.drafts).toEqual(drafts);
});
it('D33-CARD-01 / UI-AUDIT-04 cards are not links; the 打开会话 button is the keyboard path', async () => {
  const card = host.querySelector<HTMLElement>('[data-testid="activity-message-card"]')!;
  expect(card.getAttribute('role')).toBeNull(); expect(card.hasAttribute('tabindex')).toBe(false); expect(card.getAttribute('aria-label')).toBeNull();
  expect(host.querySelector('[role="link"]')).toBeNull();
  expect(card.textContent).toContain('任务说明');
  const open = card.querySelector<HTMLButtonElement>('.act-card__open')!;
  expect(open.type).toBe('button'); expect(open.textContent).toBe('打开会话');
  expect(open.getAttribute('aria-label')).toBe('打开会话：手机一号');
  open.focus(); expect(document.activeElement).toBe(open);
  await act(async () => open.click());
  expect(S.teamFocus).toBe(second); expect(S.teamView).toBe('single');
});
it('D33-CARD-01 expand and task dependency controls do not enter a conversation', async () => {
  await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="activity-message-expand"]')!.click(); });
  expect(S.teamView).toBe('board');
  await act(async () => { host.querySelector<HTMLButtonElement>('.act-card__dep')!.click(); });
  expect(S.teamView).toBe('board');
});
it('D33-CARD-01 broadcast enters the sender lane and unassigned cards have no fake navigation', async () => {
  feed.messages[0].to_agent_id = '*';
  feed.messages.push({ ...feed.messages[0], id: 'unknown', to_agent_id: 'user' });
  await act(async () => root.render(<TeamActivityView team={S.teams[0]} />));
  expect(host.querySelector('[data-message-id="unknown"]')!.getAttribute('role')).toBeNull();
  expect(host.querySelector('[data-message-id="unknown"] .act-card__open')).toBeNull();
  expect(host.querySelector('[data-message-id="message"] .act-card__open')?.getAttribute('aria-label')).toBe('打开会话：Lom');
  await act(async () => host.querySelector<HTMLElement>('[data-message-id="message"]')!.click());
  expect(S.teamFocus).toBe(first);
});
it('D33-CARD-01 a removed member cannot navigate to an arbitrary conversation', async () => {
  S.teams[0].members = S.teams[0].members.filter(m => m.mid !== second);
  await act(async () => { expect(openTeamMember(S.teams[0].id, second)).toBe(false); });
  expect(S.teamView).toBe('board');
});
it('UI-AUDIT-04 board columns and activity segmented controls have accessible names', async () => {
  expect([...host.querySelectorAll('[data-testid="activity-board-column"]')].map(c => c.getAttribute('aria-label'))).toEqual(['Lom', '手机一号']);
  expect([...host.querySelectorAll('[role="radiogroup"]')].map(g => g.getAttribute('aria-label'))).toEqual(['排序', '内容筛选']);
});
