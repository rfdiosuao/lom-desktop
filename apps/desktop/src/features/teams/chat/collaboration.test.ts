import { expect, it, vi } from 'vitest';
import { channelEnvelope, channelOf } from '@/features/chat/runtime/channelSource';
import { S } from '@/state/store';
import type { Conv, Msg, Team, TeamChatMeta } from '@/state/types';
import type { TeamMailboxMessage, TeamTask } from '../activity/activityTypes';
import { assistantDispatchMeta } from './chain';
import { teamChatTimeline, type ChatSource } from './timeline';

const conv = (id: string, messages: Msg[], extra: Partial<Conv> = {}): Conv => ({ id, owner: 'pc', title: id, updated: 1, messages, ...extra });
const mail = (id: string, from: string, to: string, msg_type: string, at: number, content = '', summary: string | null = null): TeamMailboxMessage =>
  ({ id, team_id: 'core1', from_agent_id: from, to_agent_id: to, msg_type, content, summary, files: [], read: true, created_at: at });
const team = (extra: Partial<Team> = {}) => ({ id: 't1', name: '队', folder: '/w', created: 1, real: true, panes: {}, leaderConv: 'lead', memberConvs: { r: 'mem-r' },
  members: [{ mid: 'l', agent: 'pc', role: '队长', leader: true }, { mid: 'r', agent: 'ag:x', role: '研究员' }],
  core: { id: 'core1', assistant: 'a', slots: { l: 's-lead', r: 's-r' } }, ...extra }) as Team;

it('TEAM-CHAT-01B AC-B2 AC-B3 leader dispatch, task and completion notice map to members by slot; the leader summary is its own reply', () => {
  const t = team();
  const lead = conv('lead', [{ id: 'u', type: 'user', at: 10, text: '开始', teamChat: { post: 'p', chain: 'c', hop: 0, team: 't1', from: { kind: 'user' }, to: [{ key: 'm:l', name: 'Lom' }] } },
    { id: 'a1', type: 'assistant', at: 11, text: '我来分工' }, { id: 'a2', type: 'assistant', at: 40, text: '研究员已完成，汇总如下' }]);
  const member = conv('mem-r', [{ id: 'mu', type: 'teammate', at: 20, text: '查定价', agent: 'Lom' }, { id: 'ma', type: 'assistant', at: 25, text: '查完了' }]);
  member.messages.unshift({ id: 'old', type: 'user', at: 1, text: '早先', turnOutcome: 'completed' });
  const sources: ChatSource[] = [{ key: 'm:l', conv: lead, assistant: false }, { key: 'm:r', conv: member, assistant: false }];
  const task: TeamTask = { id: 'k', team_id: 'core1', subject: '抓三家定价', status: 'in_progress', owner: 's-r', blocked_by: [], blocks: [], created_at: 19, updated_at: 19 };
  const items = teamChatTimeline(t, sources, { messages: [mail('m1', 's-lead', 's-r', 'message', 20, '去查定价'), mail('m2', 's-r', 's-lead', 'idle_notification', 30, '', '定价已整理')], tasks: [task] });
  const brief = items.map(i => i.kind === 'mail' ? `mail:${i.from}>${i.to}` : i.kind === 'task' ? `task:${i.owner}` : i.kind === 'reply' ? `reply:${i.msgs.map(m => m.id).join(',')}` : i.kind);
  expect(brief).toEqual(['direct', 'post', 'reply:a1', 'task:m:r', 'mail:m:l>m:r', 'reply:ma', 'mail:m:r>m:l', 'reply:a2']);
  // 成员这一轮由队长来信触发，没有用户消息，平台终态不可信：不显示「已完成」
  expect(items.find(i => i.kind === 'mail' && i.message.msg_type === 'idle_notification')).toMatchObject({ outcome: undefined });
});

it('TEAM-CHAT-01B AC-B4 a dispatch-done reminder in the assistant chat shows as the member reporting back, with the platform outcome', () => {
  const t = team({ chatAssistant: 'pa_1' });
  const member = conv('mem-r', [{ id: 'u', type: 'user', at: 5, text: '查', turnOutcome: 'completed' }, { id: 'r', type: 'assistant', at: 6, text: '好了' }]);
  const raw = `${channelEnvelope('dispatch_done', 'mem-r')}来自「mem-r」的任务已完成`;
  const notice: Msg = { id: 'n', type: 'user', at: 9, text: '来自「mem-r」的任务已完成', ...channelOf(raw) } as Msg;
  expect(notice).toMatchObject({ source: 'dispatch_done', dispatchOf: 'mem-r' });
  const pa = conv('pa', [notice, { id: 'v', type: 'assistant', at: 10, text: '核对过了，结论如下' }], { personal: { id: 'pa_1', name: '小鹿', directory: '/d' } });
  const items = teamChatTimeline(t, [{ key: 'm:r', conv: member, assistant: false }, { key: 'pa:pa_1', conv: pa, assistant: true }]);
  expect(items.filter(i => i.kind === 'report')).toEqual([expect.objectContaining({ from: 'm:r', to: 'pa:pa_1', outcome: 'completed' })]);
  expect(items.at(-1)).toMatchObject({ kind: 'reply', msgs: [expect.objectContaining({ id: 'v' })] });
});

it('TEAM-CHAT-01B AC-B5 the assistant may dispatch 8 times on one chain; the 9th is refused, reminders never add a hop', () => {
  vi.stubGlobal('crypto', { ...crypto, randomUUID: () => 'post-new' });
  const t = team({ chatAssistant: 'pa_1' });
  const post: TeamChatMeta = { post: 'p0', chain: 'chain-1', hop: 0, team: 't1', from: { kind: 'user' }, to: [{ key: 'pa:pa_1', name: '小鹿' }] };
  const self = conv('pa', [{ id: 'g', type: 'user', at: 1, text: '安排一下', teamChat: post }, { id: 'n', type: 'user', at: 2, text: '提醒', source: 'dispatch_done', dispatchOf: 'mem-r' }],
    { personal: { id: 'pa_1', name: '小鹿', directory: '/d' } });
  const dispatched = (n: number) => Array.from({ length: n }, (_, i): Msg => ({ id: `d${i}`, type: 'user', at: 3 + i, text: 'x',
    teamChat: { post: `d${i}`, chain: 'chain-1', hop: i + 1, team: 't1', from: { kind: 'personal', id: 'pa_1' }, to: [{ key: 'm:r', name: 'R' }] } }));
  S.convs = [conv('lead', []), conv('mem-r', dispatched(7))];
  expect(assistantDispatchMeta(t, self, t.members[1])).toMatchObject({ chain: 'chain-1', hop: 8, from: { kind: 'personal', id: 'pa_1' }, to: [{ key: 'm:r', role: '研究员' }] });
  S.convs = [conv('lead', []), conv('mem-r', dispatched(8))];
  expect(() => assistantDispatchMeta(t, self, t.members[1])).toThrow(expect.objectContaining({ code: 'team.hop_limit' }));
  // 用户在群聊里的新发言开新链
  self.messages.push({ id: 'g2', type: 'user', at: 99, text: '换个方向', teamChat: { ...post, post: 'p9', chain: 'chain-2' } });
  expect(assistantDispatchMeta(t, self, t.members[1])).toMatchObject({ chain: 'chain-2', hop: 1 });
  // 助理不在这个团队的群聊里：不附加信封，行为与以前一致
  expect(assistantDispatchMeta(team(), self, t.members[1])).toBeUndefined();
  vi.unstubAllGlobals();
});
