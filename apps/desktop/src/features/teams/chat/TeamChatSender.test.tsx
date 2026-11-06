import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Conv, Team, TeamChatMeta } from '@/state/types';

const m = vi.hoisted(() => ({ api: vi.fn(), directory: [] as Array<Record<string, unknown>> }));
vi.mock('@/core/client', async original => ({ ...await original<object>(), api: m.api }));
vi.mock('@/features/chat/ui/Chat', () => ({ useStickBottom: () => ({ ref: undefined, onScroll: vi.fn() }) }));
vi.mock('@/features/chat/ui/Composer', () => ({ Composer: () => <div /> }));
vi.mock('../activity/TeamActivityView', () => ({ TeamActivityView: () => <div /> }));
vi.mock('@/features/personal/runtime/session', () => ({ ensureConversation: vi.fn() }));
vi.mock('@/features/personal/runtime/catalog', async original => ({ ...await original<object>(), loadAssistants: () => ({ items: m.directory }) }));
const { TeamPage } = await import('../ui/TeamPage');
const { TeamChatSource } = await import('./TeamChatSource');
const { S } = await import('@/state/store');
const { initialState } = await import('@/state/state');

let root: Root, host: HTMLDivElement, team: Team;
const dispatch = (from: TeamChatMeta['from'], post = 'p1'): TeamChatMeta => ({ post, chain: 'c', hop: 1, team: 't1', from, to: [{ key: 'm:l', name: 'Lom' }] });
const conv = (id: string, extra: Partial<Conv>): Conv => ({ id, owner: 'pc', title: id, updated: 1, remote: true, loaded: true, messages: [], ...extra });
const assistant = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, directory: '/d', workspace: '/d', avatar: '02', ...extra });
const dispatched = (from: TeamChatMeta['from']) => ({ id: 'u1', type: 'user' as const, at: 1, text: '开始电脑清理任务', source: 'team_chat' as const, teamChat: dispatch(from) });

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(S, initialState(false));
  m.api.mockReset(); m.api.mockResolvedValue({ items: [], model: { provider_id: 'own', model: 'm1' }, runtime: { is_processing: false } });
  m.directory = [assistant('pa_other', '清理助理', { avatar: '03' })];
  S.cloud = 'signed-in'; S.account = { id: 'acc', name: 'A', email: '' };
  // 这个团队选的群聊助理是 pa_chat；派活的是另一位 pa_other
  team = { id: 't1', name: '调研队', folder: '/w', created: 1, real: true, panes: {}, ownerAccountId: 'acc', chatAssistant: 'pa_chat', leaderConv: 'lead1',
    members: [{ mid: 'l', agent: 'pc', role: '队长', leader: true }], memberConvs: {} };
  S.teams = [team]; S.convs = [conv('lead1', { messages: [dispatched({ kind: 'personal', id: 'pa_other', name: '旧名字' })] })];
  S.route = { name: 'team', id: 't1' }; S.teamView = 'chat';
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); });

const sender = async () => {
  await act(async () => root.render(<TeamPage />));
  const event = host.querySelector('.team-chat__event')!;
  return { name: event.querySelector('.msg__name')!.textContent, meta: event.querySelector('.msg__meta')!.textContent ?? '', img: event.querySelector('img')?.getAttribute('src'), text: event.textContent };
};

it('TEAM-CHAT-01E AC-E1 an assistant that is not the group-chat assistant is shown with its own name and avatar', async () => {
  const s = await sender();
  expect(s.name).toBe('清理助理');
  expect(s.img).toBe('/mascots/deer-03.png');
  expect(s.text).toContain('→ @Lom');
  expect(host.textContent).not.toContain('已移除的成员');
});

it('TEAM-CHAT-01E AC-E1 the custom avatar of the sender is used', async () => {
  const image = 'data:image/jpeg;base64,/9j/AAAA';
  m.directory = [assistant('pa_other', '清理助理', { avatarImage: image })];
  expect((await sender()).img).toBe(image);
});

it('TEAM-CHAT-01E AC-E2 a deleted assistant shows as removed and keeps the recorded name readable', async () => {
  m.directory = [assistant('pa_unrelated', '别人')];
  const s = await sender();
  expect(s.name).toBe('已移除的助理');
  expect(s.meta).toContain('来自个人助理：旧名字');
  expect(host.textContent).not.toContain('已移除的成员');
});

it('TEAM-CHAT-01E AC-E3 a renamed assistant shows the new name on old messages', async () => {
  m.directory = [assistant('pa_other', '新名字')];
  const s = await sender();
  expect(s.name).toBe('新名字');
  expect(host.textContent).not.toContain('旧名字');
});

it('TEAM-CHAT-01E AC-E4 an unreadable directory never claims the assistant was removed', async () => {
  S.cloud = 'signed-out';
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const s = await sender();
  expect(s.name).toBe('旧名字');
  expect(host.textContent).not.toContain('已移除');
  warn.mockRestore();
});

it('TEAM-CHAT-01E AC-E5 the user keeps showing as 你', async () => {
  S.convs = [conv('lead1', { messages: [dispatched({ kind: 'user' })] })];
  await act(async () => root.render(<TeamPage />));
  expect(host.querySelector('.team-chat__post')!.textContent).toContain('来自群聊 · 你');
  expect(host.querySelector('.team-chat__event')).toBeNull();
});

it('TEAM-CHAT-01E AC-E2 the source line on a dispatched task names the removed assistant', async () => {
  m.directory = [];
  await act(async () => root.render(<TeamChatSource meta={dispatch({ kind: 'personal', id: 'pa_gone', name: '小鹿' })} />));
  expect(host.textContent).toBe('来自个人助理：小鹿（已移除） → @Lom');
});

it('TEAM-CHAT-01E AC-E1 the source line uses the current name for a non-member assistant', async () => {
  await act(async () => root.render(<TeamChatSource meta={dispatch({ kind: 'personal', id: 'pa_other' })} />));
  expect(host.textContent).toBe('来自个人助理：清理助理 → @Lom');
});
