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
  Object.assign(S, initialState());
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
it('D33-CARD-01 Enter activates a focused card', async () => {
  const card = host.querySelector<HTMLElement>('[data-testid="activity-message-card"]')!;
  expect(card.getAttribute('role')).toBe('link'); expect(card.tabIndex).toBe(0);
  await act(async () => { card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
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
  await act(async () => host.querySelector<HTMLElement>('[data-message-id="message"]')!.click());
  expect(S.teamFocus).toBe(first);
});
it('D33-CARD-01 a removed member cannot navigate to an arbitrary conversation', async () => {
  S.teams[0].members = S.teams[0].members.filter(m => m.mid !== second);
  await act(async () => { expect(openTeamMember(S.teams[0].id, second)).toBe(false); });
  expect(S.teamView).toBe('board');
});
