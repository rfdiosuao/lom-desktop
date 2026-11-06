import { beforeEach, expect, it, vi } from 'vitest';
import { messageEnvelope } from '@/features/chat/runtime/channelSource';
import { mapHistory } from '@/features/chat/runtime/history';
import { initialState, loadPersisted, persist } from '@/state/state';
import { S } from '@/state/store';
import type { CoreMessage } from '@/core/types';
import type { Conv, Team, TeamChatMeta } from '@/state/types';
import { beginFlight, settleStalePending } from './posts';
import { teamChatMentionMenu } from './menus';
import { teamChatTimeline, type ChatSource } from './timeline';

const meta: TeamChatMeta = { post: 'p1', chain: 'c1', hop: 0, team: 't1', from: { kind: 'user' }, to: [{ key: 'm:b', name: 'CodeBuddy', role: '分析' }] };
const conv = (id: string, extra: Partial<Conv> = {}): Conv => ({ id, owner: 'pc', title: id, updated: 1, messages: [], loaded: true, remote: true, ...extra });
const row = (id: string, position: 'left' | 'right', content: string, at: number): CoreMessage => ({ id, msg_id: `r${id}`, conversation_id: 'mem-b', type: 'text', position, content: { content }, created_at: at });
const team = (): Team => ({ id: 't1', name: '队', folder: '/w', created: 1, real: true, panes: {}, ownerAccountId: 'acc', leaderConv: 'lead', memberConvs: { a: 'mem-a', b: 'mem-b' },
  core: { id: 'core1', assistant: 'x', slots: { l: 's-l', a: 's-a', b: 's-b' } },
  members: [{ mid: 'l', agent: 'pc', role: '队长', leader: true }, { mid: 'a', agent: 'ag:buddy', role: '检索' }, { mid: 'b', agent: 'ag:buddy', role: '分析' }],
  chatPosts: [{ id: 'p1', at: 1, chain: 'c1', text: '整理数据', deliveries: [{ key: 'm:b', state: 'accepted', conv: 'mem-b' }] }] });

beforeEach(() => {
  localStorage.clear();
  S.agentCatalog = [{ id: 'buddy', name: 'CodeBuddy', backend: 'codebuddy', agent_type: 'acp', agent_source: 'builtin', enabled: true, installed: true, status: 'online' }];
});

it('TEAM-CHAT-01D AC-D1 after a restart the timeline is rebuilt from the saved index and core history, in order and without duplicates', () => {
  const before = initialState(false); before.teams = [team()]; persist(before);
  const after = initialState(false); loadPersisted(after);
  expect(after.teams[0].chatPosts).toEqual(team().chatPosts);
  // 核心保存的原文带隐藏信封；重启后从历史里解析出关联，界面只显示正文
  const raw = `${messageEnvelope({ id: 'x', type: 'user', at: 2, teamChat: meta })}整理数据`;
  const member = conv('mem-b');
  member.messages = mapHistory([row('1', 'right', raw, 2), row('2', 'left', '好的，已整理', 3)], member).messages;
  expect(member.messages[0]).toMatchObject({ type: 'user', text: '整理数据', source: 'team_chat', teamChat: meta });
  const sources: ChatSource[] = [{ key: 'm:b', conv: member, assistant: false }];
  const items = teamChatTimeline(after.teams[0], sources);
  expect(items.map(i => i.kind)).toEqual(['post', 'reply']);
  expect(teamChatTimeline(after.teams[0], sources).map(i => i.id)).toEqual(items.map(i => i.id));
});

it('TEAM-CHAT-01D a delivery left "in progress" by a restart settles from facts, never stays in progress and is never resent', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const t = team();
  t.chatPosts = [{ id: 'p2', at: 5, chain: 'c', text: '再查', deliveries: [{ key: 'm:a', state: 'pending' }, { key: 'm:b', state: 'pending' }, { key: 'm:l', state: 'pending' }] }];
  const seen = conv('mem-b', { messages: [{ id: 'u', type: 'user', at: 5, text: '再查', teamChat: { ...meta, post: 'p2' } }] });
  const notLoaded = conv('lead', { loaded: false });
  settleStalePending(t, new Map([['m:a', conv('mem-a')], ['m:b', seen], ['m:l', notLoaded]]));
  expect(t.chatPosts[0].deliveries.map(d => d.state)).toEqual(['unconfirmed', 'accepted', 'pending']);
  expect(warn).toHaveBeenCalledWith('team.chat_delivery_unconfirmed', { team: 't1', post: 'p2', to: 'm:a' });
  // 本进程正在投递的不动
  t.chatPosts[0].deliveries[2].state = 'pending';
  const land = beginFlight('p2', 'm:l');
  settleStalePending(t, new Map([['m:l', conv('lead')]]));
  expect(t.chatPosts[0].deliveries[2].state).toBe('pending');
  land();
  warn.mockRestore();
});

it('TEAM-CHAT-01D same-name members stay apart: by slot in the mailbox, by role in the mention list', () => {
  const t = team();
  S.teams = [t];
  const items = teamChatTimeline(t, [], { messages: [{ id: 'm1', team_id: 'core1', from_agent_id: 's-b', to_agent_id: 's-l', msg_type: 'message', content: '分析好了', files: [], read: true, created_at: 9 }], tasks: [] });
  expect(items.find(i => i.kind === 'mail')).toMatchObject({ kind: 'mail', from: 'm:b', to: 'm:l' });
  const menu = teamChatMentionMenu('teamchat:t1').filter(i => i !== '-' && !i.header && i.label === 'CodeBuddy');
  expect(menu.map(i => (i as { desc?: string }).desc)).toEqual(['检索', '分析']);
});
