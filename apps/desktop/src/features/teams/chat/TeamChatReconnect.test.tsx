import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Team } from '@/state/types';

const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', async original => ({ ...await original<object>(), api: m.api }));
vi.mock('@/features/chat/ui/Chat', () => ({ useStickBottom: () => ({ ref: undefined, onScroll: vi.fn() }) }));
vi.mock('@/features/chat/ui/Composer', () => ({ Composer: () => <div data-testid="composer" /> }));
vi.mock('@/features/chat/runtime/tasks', async original => ({ ...await original<object>(), openTask: vi.fn() }));
const { TeamChatView } = await import('./TeamChatView');
const { sendTeamChatDraft } = await import('../actions/teamChat');
const { emitActivityEvent, emitActivityReconnect } = await import('../activity/activityEvents');
const { beginAuthChange } = await import('@/features/account/runtime/authScope');
const { S } = await import('@/state/store');
const { initialState } = await import('@/state/state');

let root: Root, host: HTMLDivElement, team: Team;
const mail = { id: 'm1', team_id: 'core1', from_agent_id: 's-l', to_agent_id: 's-r', msg_type: 'message', content: '去查定价', files: [], read: true, created_at: 5 };
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 30)); });

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(S, initialState(false));
  S.cloud = 'signed-in'; S.account = { id: 'acc', name: 'A', email: '' }; S.conn = 'ready';
  m.api.mockReset();
  m.api.mockImplementation(async (method: string, path: string) => (method === 'GET' && path.includes('/activity') ? { items: [{ kind: 'message', id: 'm1', created_at: 5, message: mail }], has_more: false } : {}));
  team = { id: 't1', name: '队', folder: '/w', created: 1, real: true, panes: {}, ownerAccountId: 'acc', leaderConv: 'lead', memberConvs: { r: 'mem' },
    core: { id: 'core1', assistant: 'x', slots: { l: 's-l', r: 's-r' } },
    members: [{ mid: 'l', agent: 'pc', role: '队长', leader: true }, { mid: 'r', agent: 'pc', role: '研究员' }],
    chatPosts: [{ id: 'p1', at: 1, chain: 'c', text: '账号 A 的发言', deliveries: [{ key: 'm:l', state: 'accepted' }] }] };
  S.teams = [team];
  S.convs = [{ id: 'lead', owner: 'pc', title: 'l', updated: 1, loaded: true, messages: [] }, { id: 'mem', owner: 'pc', title: 'r', updated: 1, loaded: true, messages: [] }];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); });
const mails = () => [...host.querySelectorAll('.team-chat__event')].filter(e => e.textContent?.includes('去查定价'));

it('TEAM-CHAT-01D AC-D2 replayed mailbox events and a reconnect reload never duplicate items or send anything', async () => {
  await act(async () => root.render(<TeamChatView team={team} />));
  await flush();
  expect(mails()).toHaveLength(1);
  await act(async () => { emitActivityEvent('team.mailboxChanged', { team_id: 'core1', message: mail }); emitActivityEvent('team.mailboxChanged', { team_id: 'core1', message: mail }); });
  await act(async () => { emitActivityReconnect(); });
  await flush();
  expect(mails()).toHaveLength(1);
  expect(m.api.mock.calls.filter(c => c[0] !== 'GET')).toEqual([]);
});

it('TEAM-CHAT-01D AC-D5 after switching accounts the previous account team chat is hidden, cannot post, and picked recipients are cleared', async () => {
  S.teamChatTargets = { t1: ['m:r'] };
  beginAuthChange();
  expect(S.teamChatTargets).toEqual({});
  S.account = { id: 'other', name: 'B', email: '' };
  await act(async () => root.render(<TeamChatView team={team} />));
  expect(host.textContent).toContain('这个团队属于其他账号');
  expect(host.textContent).not.toContain('账号 A 的发言');
  await sendTeamChatDraft('teamchat:t1', '冒充发言', [], () => () => {});
  expect(team.chatPosts).toHaveLength(1);
  expect(m.api).not.toHaveBeenCalled();
});
