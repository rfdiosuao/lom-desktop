import { beforeEach, expect, it } from 'vitest';
import { initialState, type AppState } from '@/state/state';
import type { Conv, Team } from '@/state/types';
import { buildPhoneActivity, phoneActivityLanes, teamPhoneConversations } from './phoneActivity';
import { filterActivityItems, sortActivityItems } from './activityTypes';
let state: AppState, team: Team, conv: Conv;
beforeEach(() => {
  state = initialState();
  state.cloud = 'signed-in'; state.account = { id: 'account' } as AppState['account'];
  state.agents.dev_phone = { id: 'dev_phone', name: '工作手机', kind: 'phone', persona: '', status: 'online', real: true };
  team = { ...state.teams[0], id: 'team', real: true, members: [{ mid: 'lead', agent: 'pc', role: '总指挥', leader: true }, { mid: 'mobile', agent: 'dev_phone', role: '手机' }] };
  conv = { id: 'conv', owner: 'dev_phone', teamId: team.id, title: '查看资料', updated: 5, loaded: true, phoneSession: 'session', messages: [
    { id: 'u', at: 1, type: 'user', text: '查看资料' }, { id: 'a', at: 3, type: 'assistant', text: '这是手机真实回复', attachments: [{ name: '资料.png' }] },
    { id: 'sys', at: 4, type: 'system', text: '连接中断，状态未知' }, { id: 'tool', at: 2, type: 'tool', tool: 'phone_task_read', output: '不要重复此结果' },
  ] };
  state.convs = [conv]; team.memberConvs = { mobile: conv.id }; state.teams = [team];
});
it('PHONE-TEAM-01 includes only real team phone conversations; no unrelated or desktop tool copies', () => {
  state.convs.push({ ...conv, id: 'foreign-team', teamId: 'other' }, { ...conv, id: 'no-team', teamId: undefined }, { ...conv, id: 'desktop', remote: true });
  expect(teamPhoneConversations(team, state).map(c => c.id)).toEqual(['conv']);
  const items = buildPhoneActivity(team, state);
  expect(items).toHaveLength(4);
  expect(items.every(i => i.kind === 'phone' && i.lane === 'phone:mobile')).toBe(true);
  expect(JSON.stringify(items)).not.toContain('不要重复此结果');
  expect(items.find(i => i.id.endsWith(':a'))).toMatchObject({ phone: { files: 1, label: '手机回复' } });
});
it('PHONE-TEAM-01 removed authorization and signed-out accounts cannot expose cached phone activity', () => {
  state.cloud = 'signed-out'; expect(buildPhoneActivity(team, state)).toEqual([]); expect(phoneActivityLanes(team, state)).toEqual([]);
  state.cloud = 'signed-in'; state.agents.dev_phone.real = false;
  expect(buildPhoneActivity(team, state)).toEqual([]); expect(phoneActivityLanes(team, state)).toEqual([]);
  state.agents.dev_phone.real = true; team.members = team.members.slice(0, 1);
  expect(buildPhoneActivity(team, state)).toEqual([]);
});
it('PHONE-TEAM-01 a phone without core slots still has a lane and an offline phone is never idle', () => {
  team.core = undefined; state.agents.dev_phone.status = 'offline'; state.running.conv = true;
  expect(phoneActivityLanes(team, state)[0]).toMatchObject({ name: '工作手机', status: '离线', local: true });
  expect(buildPhoneActivity(team, state)[0]).toMatchObject({ phone: { label: '离线 · 执行状态未知', finished: false } });
});
it('PHONE-TEAM-01 pending send and running/idle snapshots do not pretend successful completion', () => {
  conv.phonePending = { client_id: 'pending', session_id: '', text: 'pending' };
  expect(buildPhoneActivity(team, state)[0]).toMatchObject({ phone: { label: '发送结果待确认' } });
  delete conv.phonePending; state.running.conv = true;
  expect(buildPhoneActivity(team, state)[0]).toMatchObject({ phone: { label: '执行中' } });
  state.running.conv = false;
  expect(buildPhoneActivity(team, state)[0]).toMatchObject({ phone: { label: '执行状态未知', finished: false } });
  conv.phoneRunStatus = 'completed';
  expect(buildPhoneActivity(team, state)[0]).toMatchObject({ phone: { label: '已完成', finished: true } });
  conv.phoneRunStatus = 'failed';
  expect(buildPhoneActivity(team, state)[0]).toMatchObject({ phone: { label: '执行失败', finished: false } });
  conv.loaded = false;
  expect(buildPhoneActivity(team, state)[0]).toMatchObject({ phone: { label: '等待同步' } });
});
it('PHONE-TEAM-01 filters original messages, task state, system notes and members with stable sort', () => {
  const filter = { kind: 'all' as const, members: new Set<string>(), showSystemMessages: false, showFinishedTasks: false };
  const items = sortActivityItems(buildPhoneActivity(team, state), 'desc');
  expect(filterActivityItems(items, filter).map(i => i.id)).toEqual(['phone-task:conv', 'phone-message:conv:a', 'phone-message:conv:u']);
  expect(filterActivityItems(items, { ...filter, kind: 'task' })).toHaveLength(1);
  expect(filterActivityItems(items, { ...filter, kind: 'message', showSystemMessages: true })).toHaveLength(3);
  expect(filterActivityItems(items, { ...filter, members: new Set(['other']) })).toEqual([]);
  expect(sortActivityItems(items, 'asc').map(i => i.createdAt)).toEqual([1, 3, 4, 5]);
});

it('PHONE-TEAM-01 finished filtering only hides phone-confirmed completed/cancelled tasks', () => {
  conv.phoneRunStatus = 'completed';
  const filter = { kind: 'task' as const, members: new Set<string>(), showSystemMessages: false, showFinishedTasks: false };
  expect(filterActivityItems(buildPhoneActivity(team, state), filter)).toHaveLength(0);
  expect(filterActivityItems(buildPhoneActivity(team, state), { ...filter, showFinishedTasks: true })).toHaveLength(1);
  conv.phoneRunStatus = 'failed'; expect(filterActivityItems(buildPhoneActivity(team, state), filter)).toHaveLength(1);
  conv.phoneRunStatus = 'unknown'; state.running.conv = true;
  expect(buildPhoneActivity(team, state)[0]).toMatchObject({ phone: { label: '同步中断 · 执行状态未知' } });
});
