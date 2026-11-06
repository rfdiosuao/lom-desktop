import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Conv, Team, TeamChatMeta } from '@/state/types';

const m = vi.hoisted(() => ({ api: vi.fn(), ensureConversation: vi.fn() }));
vi.mock('@/core/client', async original => ({ ...await original<object>(), api: m.api }));
vi.mock('@/features/chat/ui/Chat', () => ({ useStickBottom: () => ({ ref: undefined, onScroll: vi.fn() }) }));
vi.mock('@/features/chat/ui/Composer', () => ({ Composer: ({ ckey }: { ckey: string }) => <div data-testid="composer" data-ckey={ckey} /> }));
vi.mock('../activity/TeamActivityView', () => ({ TeamActivityView: () => <div data-testid="board" /> }));
vi.mock('@/features/personal/runtime/session', () => ({ ensureConversation: m.ensureConversation }));
vi.mock('@/features/personal/runtime/catalog', async original => ({ ...await original<object>(),
  loadAssistants: () => ({ items: [{ id: 'pa_1', name: '小鹿', directory: '/d', workspace: '/d', avatar: '02', conversation: 'pa-conv' }] }) }));
const { TeamPage } = await import('../ui/TeamPage');
const { TeamChatSource } = await import('./TeamChatSource');
const { S, update } = await import('@/state/store');
const { initialState } = await import('@/state/state');

let root: Root, host: HTMLDivElement, team: Team;
const meta = (post: string, key: string, name: string): TeamChatMeta => ({ post, chain: 'c', hop: 0, team: 't1', from: { kind: 'user' }, to: [{ key, name }] });
const conv = (id: string, extra: Partial<Conv>): Conv => ({ id, owner: 'pc', title: id, updated: 1, remote: true, loaded: true, messages: [], ...extra });

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(S, initialState(false));
  m.api.mockReset(); m.api.mockResolvedValue({ items: [], model: { provider_id: 'own', model: 'm1' }, runtime: { is_processing: false } }); // 并排视图读历史的 GET
  S.cloud = 'signed-in'; S.account = { id: 'acc', name: 'A', email: '' };
  team = { id: 't1', name: '调研队', folder: '/w', created: 1, real: true, panes: {}, ownerAccountId: 'acc', chatAssistant: 'pa_1', leaderConv: 'lead1',
    members: [{ mid: 'l', agent: 'pc', role: '队长', leader: true }], memberConvs: {},
    chatPosts: [{ id: 'p1', at: 1, chain: 'c', text: '小鹿帮我看下进度', deliveries: [{ key: 'pa:pa_1', state: 'accepted', conv: 'pa-conv' }] }] };
  S.teams = [team];
  S.convs = [conv('lead1', {}), conv('pa-conv', { personal: { id: 'pa_1', name: '小鹿', directory: '/d', avatar: '02' }, messages: [
    { id: 'u1', type: 'user', at: 1, text: '小鹿帮我看下进度', source: 'team_chat', teamChat: meta('p1', 'pa:pa_1', '小鹿') },
    { id: 'a1', type: 'assistant', at: 2, text: '已经在看了' }] })];
  S.route = { name: 'team', id: 't1' }; S.teamView = 'side';
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); });
const choose = async (title: string) => { await act(async () => host.querySelector<HTMLButtonElement>(`[role="radio"][title="${title}"]`)!.click()); };

it('TEAM-CHAT-01A AC-A1 AC-D3 switching to and away from the group chat never sends anything', async () => {
  await act(async () => root.render(<TeamPage />));
  for (const view of ['群聊', '看板', '群聊', '并排', '单个', '群聊']) await choose(view);
  expect(host.querySelector('.team-chat')).not.toBeNull();
  expect(host.querySelector('[data-testid="composer"]')?.getAttribute('data-ckey')).toBe('teamchat:t1');
  expect(m.api.mock.calls.filter(c => c[0] !== 'GET')).toEqual([]);
  expect(S.convs.find(c => c.id === 'pa-conv')!.messages).toHaveLength(2);
});

it('TEAM-CHAT-01A AC-A5 the personal assistant speaks in the group with its own name and avatar', async () => {
  S.teamView = 'chat';
  await act(async () => root.render(<TeamPage />));
  const chat = host.querySelector('.team-chat')!;
  expect(chat.querySelector('.team-chat__head')!.textContent).toContain('小鹿');
  expect(chat.textContent).toContain('来自群聊 · 你 → @小鹿');
  const reply = chat.querySelector('.team-chat__reply[data-member="pa:pa_1"]')!;
  expect(reply.querySelector('.msg__name')!.textContent).toBe('小鹿');
  expect(reply.querySelector('img[alt="小鹿头像"]')!.getAttribute('src')).toBe('/mascots/deer-02.png');
  expect(reply.textContent).toContain('已经在看了');
  expect(chat.textContent).toContain('发送给：队长 Lom（默认）');
});

it('TEAM-CHAT-01B AC-B6 an agent reply that writes @someone is shown but never delivered', async () => {
  S.teamView = 'chat';
  await act(async () => root.render(<TeamPage />));
  const pa = S.convs.find(c => c.id === 'pa-conv')!;
  await act(async () => { update(() => { pa.messages.push({ id: 'a2', type: 'assistant', at: 3, text: '@Lom 你去安排一下' }); }); await new Promise(r => setTimeout(r, 30)); });
  expect(host.querySelector('.team-chat')!.textContent).toContain('@Lom 你去安排一下');
  expect(m.api.mock.calls.filter(c => c[0] !== 'GET')).toEqual([]);
  expect(S.convs.find(c => c.id === 'lead1')!.messages).toHaveLength(0);
});

it('TEAM-CHAT-01B a member conversation shows the real assistant name for a dispatched task', async () => {
  team.members.push({ mid: 'r', agent: 'ag:x', role: '研究员' });
  await act(async () => root.render(<TeamChatSource meta={{ post: 'd', chain: 'c', hop: 1, team: 't1', from: { kind: 'personal', id: 'pa_1' }, to: [{ key: 'm:r', name: '研究员甲' }] }} />));
  expect(host.textContent).toBe('来自个人助理：小鹿 → @本机 Agent');
});
