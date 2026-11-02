import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('@/features/chat/ui/Chat', () => ({ useStickBottom: () => ({ ref: undefined, onScroll: vi.fn() }) }));
vi.mock('@/features/chat/ui/Composer', () => ({ Composer: () => <div data-testid="composer" /> }));
vi.mock('@/features/chat/ui/MessageList', () => ({ MessageList: () => null }));
vi.mock('@/features/chat/ui/ReplyPending', () => ({ ReplyPending: () => null }));
vi.mock('../activity/TeamActivityView', () => ({ TeamActivityView: () => <div data-testid="board" />, fillTeamDraft: vi.fn() }));
import { TeamPage } from './TeamPage';
import { S } from '@/state/store';
import { initialState, loadPersisted } from '@/state/state';
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(S, initialState());
  S.route = { name: 'team', id: S.teams[0].id };
  S.teamView = 'side';
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); });
const choose = async (title: string) => {
  await act(async () => host.querySelector<HTMLButtonElement>(`[role="radio"][title="${title}"]`)!.click());
};
it('D33 AC-11 middle mode replaces all panes with the board and keeps exactly three mode buttons', async () => {
  await act(async () => root.render(<TeamPage />));
  expect(host.querySelectorAll('.pane').length).toBe(S.teams[0].members.length);
  await choose('看板');
  expect(host.querySelector('[data-testid="board"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="composer"]')).toBeNull();
  expect(host.querySelector('.team__panes')).toBeNull();
  expect(host.querySelectorAll('[role="radio"]')).toHaveLength(3);
  expect(host.querySelector('[title="看板"]')?.getAttribute('aria-checked')).toBe('true');
  expect(host.textContent).not.toMatch(/回到看板|会话窗格/);
  await choose('单个');
  expect(host.querySelectorAll('.pane')).toHaveLength(1);
  expect(host.querySelector('[data-testid="board"]')).toBeNull();
  await choose('并排');
  expect(host.querySelectorAll('.pane')).toHaveLength(S.teams[0].members.length);
});
it.each(['grid', 'invalid', 'side', 'single', 'board'])('D33 AC-12 restores %s preference without retaining the old grid mode', value => {
  localStorage.setItem('lom-desktop-v1', JSON.stringify({ teamView: value, prefs: { teamBoardV1: true } }));
  const state = initialState(); loadPersisted(state);
  expect(state.teamView).toBe(['grid', 'invalid'].includes(value) ? 'board' : value);
});
