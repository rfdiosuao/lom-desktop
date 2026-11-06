import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv, Team } from '@/state/types';
const m = vi.hoisted(() => ({ api: vi.fn(), send: vi.fn(), stop: vi.fn(), cancel: vi.fn(), approve: vi.fn(), phoneSend: vi.fn(), phoneStop: vi.fn() }));
vi.mock('@/core/client', async load => ({ ...await load<typeof import('@/core/client')>(), api: m.api }));
vi.mock('@/features/teams/runtime/coreTeam', () => ({ sendToCoreTeam: m.send, stopCoreTeam: m.stop, removeCoreTeam: vi.fn(), syncCoreMembers: vi.fn() }));
vi.mock('@/features/chat/runtime/cancel', () => ({ stopTask: m.cancel, isTaskStopping: () => false }));
vi.mock('@/features/personal/runtime/feishuApprovals', () => ({ requestPersonalToolApproval: m.approve }));
vi.mock('@/features/personal/runtime/capabilityApproval', () => ({ approveCapability: m.approve }));
vi.mock('@/features/phones/runtime/phoneChat', () => ({ sendPhone: m.phoneSend }));
vi.mock('@/features/phones/runtime/phoneCommander', () => ({ stopPhoneChild: m.phoneStop }));
import { executeTeamTool } from '@/features/personal/runtime/teamTools';
let self: Conv, team: Team, sequence = 0;
const call = (name: string, args: object, id = `team-${++sequence}`, live = () => true) => executeTeamTool(self, { id, scope: 'pa-tools', name, arguments: JSON.stringify(args) }, live);
const value = (r: Awaited<ReturnType<typeof call>>) => JSON.parse(r.content[0].text);
const members = [{ agent_id: 'lom', role: '主控', leader: true }];
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  S.account = { id: 'owner', name: '', email: '' }; S.cloud = 'signed-in'; S.running = {}; S.teams = []; S.agents = {}; S.agentCatalog = [];
  self = { id: 'pa', owner: 'pc', title: '', updated: 0, workspace: '/work', personal: { id: 'assistant', name: 'PA', directory: '/work' }, messages: [] };
  localStorage.setItem('lom.personal.v1:owner', JSON.stringify({ items: [{ id: 'assistant', name: 'PA', directory: '/work', workspace: '/work', conversation: 'pa', permission: 'full' }] }));
  team = { id: `t-${++sequence}`, ownerAccountId: 'owner', name: 'Team', real: true, folder: '/work', created: 0, panes: {}, members: [{ mid: 'lead', agent: 'pc', role: '主控', leader: true }] };
  S.teams = [team]; S.convs = [self];
  m.api.mockResolvedValue({ active_run: null }); m.approve.mockResolvedValue(true); m.stop.mockResolvedValue({ stopped: true, phones: 0 }); m.cancel.mockResolvedValue(true);
  m.send.mockImplementation(async (t: Team) => { t.core = { id: 'core', assistant: 'a', slots: {} }; t.leaderConv = 'lead-conv'; return true; });
});
it('PA-TOOLS-02 A/B creates only an owned configuration without running or cloning parent permissions', async () => {
  const r = value(await call('personal_team_create', { name: '研究', members }));
  expect(r).toMatchObject({ status: 'configured_in_memory', core_created: false });
  expect(S.teams[0]).toMatchObject({ name: '研究', ownerAccountId: 'owner', folder: '/work', real: true });
  expect(S.teams[0]).not.toHaveProperty('permission'); expect(m.send).not.toHaveBeenCalled();
});
it('PA-TOOLS-02 B rejects invalid roster, unknown fields, unavailable agents and demo phones', async () => {
  for (const args of [{ name: 'x', members: [] }, { name: 'x', members, account: 'other' }, { name: 'x', members: [{ agent_id: 'missing', role: 'a', leader: true }] }, { name: 'x', members: [...members, ...members] }]) expect((await call('personal_team_create', args)).isError).toBe(true);
  expect(S.teams).toHaveLength(1);
});
it('PA-TOOLS-02 B configures before start, refuses existing core and duplicate team names', async () => {
  expect(value(await call('personal_team_configure', { team_id: team.id, name: 'New', members }))).toMatchObject({ name: 'New' });
  team.core = { id: 'core', slots: {}, assistant: 'a' };
  expect((await call('personal_team_configure', { team_id: team.id, name: 'No' })).isError).toBe(true);
  expect((await call('personal_team_create', { name: 'New', members })).isError).toBe(true);
});
it('PA-TOOLS-02 D reads real run-state and exposes member session references without claiming completion', async () => {
  team.core = { id: 'core', slots: {}, assistant: 'a' }; team.leaderConv = 'lead-conv';
  m.api.mockResolvedValue({ active_run: { team_run_id: 'run-1' } });
  expect(value(await call('personal_team_read', { team_id: team.id }))).toMatchObject({ status: 'running', team_run_id: 'run-1', members: [{ session_id: 'lead-conv' }] });
  m.api.mockResolvedValue({}); expect((await call('personal_team_read', { team_id: team.id })).isError).toBe(true);
});
it('PA-TOOLS-02 C reuses shared dispatch and deduplicates the same tool call', async () => {
  const id = `dedup-${++sequence}`, args = { team_id: team.id, text: '调研并给出处' };
  const first = await call('personal_team_send', args, id); const again = await call('personal_team_send', args, id);
  expect(value(first)).toMatchObject({ status: 'accepted', session_id: 'lead-conv' }); expect(again).toEqual(first); expect(m.send).toHaveBeenCalledTimes(1);
  expect((await call('personal_team_send', { ...args, text: 'changed' }, id)).isError).toBe(true);
});
it('TEAM-ORCH-03 #373 the same dispatch text under a new call id is delivered once and reported as duplicate', async () => {
  const args = { team_id: team.id, text: '宣传片任务书：先出分镜' };
  const first = value(await call('personal_team_send', args));
  const again = value(await call('personal_team_send', args));
  expect(first).toMatchObject({ status: 'accepted', session_id: 'lead-conv' });
  expect(again).toMatchObject({ status: 'duplicate', session_id: 'lead-conv' });
  expect(again.note).toContain('没有重复投递');
  expect(m.send).toHaveBeenCalledTimes(1);
});
it('TEAM-ORCH-03 #373 after the earlier turn has finished the same text is a legitimate resend', async () => {
  const lead = { id: 'lead-conv', owner: 'pc', title: 'lead', updated: 0, messages: [{ id: 'u', type: 'user', at: Date.now() + 1000, text: '继续' }] } as unknown as Conv;
  S.convs.push(lead); team.leaderConv = 'lead-conv';
  const args = { team_id: team.id, text: '继续' };
  expect(value(await call('personal_team_send', args))).toMatchObject({ status: 'accepted' });
  expect(value(await call('personal_team_send', args))).toMatchObject({ status: 'duplicate' });
  lead.messages[0].turnOutcome = 'completed';
  expect(value(await call('personal_team_send', args))).toMatchObject({ status: 'accepted' });
  expect(m.send).toHaveBeenCalledTimes(2);
});
it('TEAM-ORCH-03 #373 changed text and a failed first delivery are never swallowed as duplicates', async () => {
  await call('personal_team_send', { team_id: team.id, text: '第一版' });
  expect(value(await call('personal_team_send', { team_id: team.id, text: '第二版' }))).toMatchObject({ status: 'accepted' });
  expect(m.send).toHaveBeenCalledTimes(2);
  m.send.mockResolvedValueOnce(false);
  expect((await call('personal_team_send', { team_id: team.id, text: '会丢的' })).isError).toBe(true);
  expect(value(await call('personal_team_send', { team_id: team.id, text: '会丢的' }))).toMatchObject({ status: 'accepted' });
});
const cliAgent = () => {
  S.agentCatalog = [{ id: 'cb', name: 'CodeBuddy', enabled: true, installed: true, status: 'online' }] as typeof S.agentCatalog;
  S.agentModelPick = {};
  localStorage.setItem('lom.agent-options:cb', JSON.stringify([{ id: 'model', category: 'model', current_value: 'hy4free', options: [{ value: 'hy4free' }, { value: 'hy3' }] }]));
};
it('TEAM-ORCH-04 #374 creates a team whose member and leader carry their own model, rejecting unlisted ones', async () => {
  cliAgent();
  const ok = value(await call('personal_team_create', { name: '宣传片', members: [{ agent_id: 'cb', role: '队长', leader: true, model: 'hy3' }, { agent_id: 'cb', role: '剪辑', model: 'auto' }] }));
  expect(ok.member_models.map((x: { model: string }) => x.model)).toEqual(['hy3', 'auto']);
  expect(S.teams.find(t => t.name === '宣传片')?.members.map(x => x.model)).toEqual(['hy3', undefined]);
  expect((await call('personal_team_create', { name: '坏模型', members: [{ agent_id: 'cb', role: '队长', leader: true, model: 'nope' }] })).isError).toBe(true);
  expect(S.teams.some(t => t.name === '坏模型')).toBe(false);
});
it('TEAM-ORCH-04 #374 Lom and phone members cannot pretend to take a model', async () => {
  expect((await call('personal_team_create', { name: 'x', members: [{ agent_id: 'lom', role: '主控', leader: true, model: 'hy3' }] })).isError).toBe(true);
});
it('TEAM-ORCH-04 #374 personal_agent_configure reads freely and writes only after approval', async () => {
  cliAgent();
  const stored = JSON.parse(localStorage.getItem('lom.personal.v1:owner')!); stored.items[0].permission = 'ask'; localStorage.setItem('lom.personal.v1:owner', JSON.stringify(stored));
  expect(value(await call('personal_agent_configure', { agent_id: 'cb' }))).toMatchObject({ default_model: 'hy4free', source: 'agent_reported', models_known: true });
  expect(m.approve).not.toHaveBeenCalled();
  m.approve.mockResolvedValueOnce(false);
  expect((await call('personal_agent_configure', { agent_id: 'cb', model: 'hy3' })).isError).toBe(true);
  expect(S.agentModelPick.cb).toBeUndefined(); expect(m.approve).toHaveBeenCalledTimes(1);
  expect(value(await call('personal_agent_configure', { agent_id: 'cb', model: 'hy3' }))).toMatchObject({ status: 'saved_in_desktop_preference', default_model: 'hy3', source: 'desktop_preference' });
  expect(S.agentModelPick.cb).toBe('hy3');
  expect(value(await call('personal_agent_configure', { agent_id: 'cb', model: 'auto' }))).toMatchObject({ default_model: 'hy4free' });
  expect(S.agentModelPick.cb).toBeUndefined();
  expect((await call('personal_agent_configure', { agent_id: 'cb', model: 'nope' })).isError).toBe(true);
  expect((await call('personal_agent_configure', { agent_id: 'ghost', model: 'hy3' })).isError).toBe(true);
});
const startedTeam = () => {
  cliAgent();
  const lead = { id: 'lead-c', owner: 'pc', title: 'lead', updated: 0, messages: [] } as unknown as Conv;
  const worker = { id: 'work-c', owner: 'pc', title: 'worker', updated: 0, messages: [] } as unknown as Conv;
  S.convs.push(lead, worker);
  team.members = [{ mid: 'lead', agent: 'ag:cb', role: '队长', leader: true }, { mid: 'w1', agent: 'ag:cb', role: '剪辑' }, { mid: 'ph', agent: 'phone-1', role: '拍摄' }];
  team.core = { id: 'core', slots: {}, assistant: 'a' }; team.leaderConv = 'lead-c'; team.memberConvs = { w1: 'work-c' };
};
const putCalls = () => m.api.mock.calls.filter(c => c[0] === 'PUT');
it('TEAM-ORCH-06 #371 switches a started team member through the core member endpoint and records it on the roster', async () => {
  startedTeam();
  m.api.mockImplementation(async (method: string) => method === 'PUT' ? { confirmation: 'pending_next_turn', config_options: null } : { active_run: null });
  const r = value(await call('personal_team_member_model', { team_id: team.id, member_id: 'w1', model: 'hy3' }));
  expect(r).toMatchObject({ status: 'saved_for_next_turn', model: 'hy3', session_id: 'work-c' });
  expect(putCalls()).toHaveLength(1);
  expect(putCalls()[0][1]).toBe('/api/teams/core/conversations/work-c/config-options/model');
  expect(putCalls()[0][2]).toEqual({ value: 'hy3' });
  expect(team.members.find(x => x.mid === 'w1')?.model).toBe('hy3');
});
it('TEAM-ORCH-06 #371 an unconfirmed switch does not change the roster and says so', async () => {
  startedTeam();
  m.api.mockImplementation(async (method: string) => method === 'PUT' ? { confirmation: 'command_ack' } : { active_run: null });
  expect(value(await call('personal_team_member_model', { team_id: team.id, member_id: 'lead', model: 'hy3' }))).toMatchObject({ status: 'submitted_unconfirmed' });
  expect(team.members.find(x => x.mid === 'lead')?.model).toBeUndefined();
});
it('TEAM-ORCH-06 #371 refuses unlisted models, Lom/phone members, unstarted teams and missing sessions without calling the core', async () => {
  startedTeam();
  for (const args of [{ member_id: 'w1', model: 'nope' }, { member_id: 'w1', model: 'auto' }, { member_id: 'ph', model: 'hy3' }, { member_id: 'ghost', model: 'hy3' }]) {
    expect((await call('personal_team_member_model', { team_id: team.id, ...args })).isError).toBe(true);
  }
  team.memberConvs = {};
  expect((await call('personal_team_member_model', { team_id: team.id, member_id: 'w1', model: 'hy3' })).isError).toBe(true);
  team.core = undefined;
  expect((await call('personal_team_member_model', { team_id: team.id, member_id: 'lead', model: 'hy3' })).isError).toBe(true);
  expect(putCalls()).toHaveLength(0);
});
it('TEAM-ORCH-06 #371 asks for approval first and sends nothing when it is denied', async () => {
  startedTeam();
  const stored = JSON.parse(localStorage.getItem('lom.personal.v1:owner')!); stored.items[0].permission = 'ask'; localStorage.setItem('lom.personal.v1:owner', JSON.stringify(stored));
  m.approve.mockResolvedValue(false);
  expect((await call('personal_team_member_model', { team_id: team.id, member_id: 'w1', model: 'hy3' })).isError).toBe(true);
  expect(m.approve).toHaveBeenCalledTimes(1);
  expect(putCalls()).toHaveLength(0);
  expect(team.members.find(x => x.mid === 'w1')?.model).toBeUndefined();
});
it('PA-TOOLS-02 C lost dispatch receipt is explicit and is never replayed', async () => {
  m.send.mockResolvedValue(false); const id = `lost-${++sequence}`, args = { team_id: team.id, text: 'do' };
  expect((await call('personal_team_send', args, id)).isError).toBe(true); await call('personal_team_send', args, id); expect(m.send).toHaveBeenCalledTimes(1);
});
it('PA-TOOLS-02 E stops using the shared lifecycle and reports only cancellation requested', async () => {
  team.core = { id: 'core', slots: {}, assistant: 'a' };
  expect(value(await call('personal_team_stop', { team_id: team.id }))).toMatchObject({ status: 'cancel_requested' }); expect(m.stop).toHaveBeenCalledTimes(1);
  const target = { ...self, id: 'task', personal: undefined }; S.convs.push(target);
  expect(value(await call('session_stop', { session_id: 'task' }))).toMatchObject({ status: 'stopped', session_id: 'task' });
  m.cancel.mockResolvedValue(false); expect((await call('session_stop', { session_id: 'task' })).isError).toBe(true);
  expect((await call('session_stop', { session_id: self.id })).isError).toBe(true);
});
it('PA-TOOLS-02 F refuses foreign/unowned teams, stale account, malformed args and missing profile', async () => {
  for (const owner of [undefined, 'someone-else']) { team.ownerAccountId = owner; expect((await call('personal_team_read', { team_id: team.id })).isError).toBe(true); }
  expect((await call('personal_team_create', { name: 'x', members }, undefined, () => false)).isError).toBe(true);
  localStorage.clear(); expect((await call('personal_team_create', { name: 'x', members })).isError).toBe(true);
  expect(m.send).not.toHaveBeenCalled();
});
it('PA-TOOLS-02 F respects current permission and refuses a late approval after target removal', async () => {
  const stored = JSON.parse(localStorage.getItem('lom.personal.v1:owner')!); stored.items[0].permission = 'ask'; localStorage.setItem('lom.personal.v1:owner', JSON.stringify(stored));
  m.approve.mockImplementation(async () => { S.teams = []; return true; });
  expect((await call('personal_team_send', { team_id: team.id, text: 'work' })).isError).toBe(true); expect(m.send).not.toHaveBeenCalled();
});
it('PA-TOOLS-02 F rejects denied approval, later-started team config and another tool reusing a call ID', async () => {
  const stored = JSON.parse(localStorage.getItem('lom.personal.v1:owner')!); stored.items[0].permission = 'ask'; localStorage.setItem('lom.personal.v1:owner', JSON.stringify(stored));
  m.approve.mockResolvedValue(false);
  expect((await call('personal_team_create', { name: 'Denied', members })).isError).toBe(true);
  m.approve.mockImplementation(async () => { team.core = { id: 'later-core', slots: {}, assistant: 'a' }; return true; });
  expect((await call('personal_team_configure', { team_id: team.id, name: 'No' })).isError).toBe(true);
  expect(team.name).toBe('Team');
});
it('PA-TOOLS-02 B accepts independently configured external agents and real phones, never phone leaders', async () => {
  S.agentCatalog = [{ id: 'cli', name: 'CLI', enabled: true, installed: true, status: 'online' }] as typeof S.agentCatalog;
  S.agents = { mobile: { id: 'mobile', name: 'Phone', persona: '', kind: 'phone', real: true, status: 'offline' } } as typeof S.agents;
  const list = [{ agent_id: 'cli', role: '代码', leader: true }, { agent_id: 'cli', role: '审查' }, { agent_id: 'mobile', role: '手机' }];
  expect((await call('personal_team_create', { name: 'External', members: list })).isError).not.toBe(true);
  expect(S.teams[0].members.map(m => m.agent)).toEqual(['ag:cli', 'ag:cli', 'mobile']);
  expect(new Set(S.teams[0].members.map(m => m.mid)).size).toBe(3);
  expect((await call('personal_team_create', { name: 'Bad', members: [{ agent_id: 'mobile', role: 'lead', leader: true }] })).isError).toBe(true);
});
it('PA-TOOLS-02 C/D refuses active core dispatch and propagates partial stop failures', async () => {
  team.core = { id: 'core', slots: {}, assistant: 'a' }; m.api.mockResolvedValue({ active_run: { team_run_id: 'busy' } });
  expect((await call('personal_team_send', { team_id: team.id, text: 'again' })).isError).toBe(true); expect(m.send).not.toHaveBeenCalled();
  m.stop.mockRejectedValue(new Error('1台手机尚未确认停止'));
  expect((await call('personal_team_stop', { team_id: team.id })).isError).toBe(true);
});
it('PA-TOOLS-02 F stop invalidates a send still preparing a core team, without sending late work', async () => {
  let resume!: () => void;
  m.send.mockImplementation(async (_team, _member, _text, _files, valid) => { await new Promise<void>(r => { resume = r; }); return valid(); });
  const send = call('personal_team_send', { team_id: team.id, text: 'late' });
  await vi.waitFor(() => expect(resume).toBeTypeOf('function'));
  expect(value(await call('personal_team_stop', { team_id: team.id }))).toMatchObject({ status: 'configured' });
  resume(); expect((await send).isError).toBe(true);
});
it('PA-TOOLS-02 F account A to B to A never revives an outstanding management operation', async () => {
  const { beginAuthChange } = await import('@/features/account/runtime/authScope');
  let resume!: () => void;
  m.api.mockImplementation(() => new Promise(r => { resume = () => r({ active_run: null }); }));
  team.core = { id: 'core', slots: {}, assistant: 'a' };
  const read = call('personal_team_read', { team_id: team.id });
  await vi.waitFor(() => expect(resume).toBeTypeOf('function'));
  beginAuthChange(); resume(); expect((await read).isError).toBe(true);
});
it('PA-TOOLS-02 F removed phone and desktop members cannot silently disappear from a dispatch', async () => {
  team.members.push({ mid: 'phone', agent: 'gone-phone', role: '手机' });
  expect((await call('personal_team_send', { team_id: team.id, text: 'phone task' })).isError).toBe(true);
  expect(m.send).not.toHaveBeenCalled();
  team.members.pop(); team.members.push({ mid: 'cli', agent: 'ag:removed', role: '审查' });
  S.agentCatalog = [{ id: 'removed', name: 'CLI', enabled: true, installed: true, status: 'online' }] as typeof S.agentCatalog;
  m.send.mockImplementation(async (_t, _m, _text, _files, current) => { S.agentCatalog = []; return current(); });
  expect((await call('personal_team_send', { team_id: team.id, text: 'late' })).isError).toBe(true);
});
it('PA-TOOLS-02 F stop eligibility is rechecked when a phone session is adopted into a team during approval', async () => {
  const target = { ...self, id: 'phone-task', personal: undefined }; S.convs.push(target);
  const stored = JSON.parse(localStorage.getItem('lom.personal.v1:owner')!); stored.items[0].permission = 'ask'; localStorage.setItem('lom.personal.v1:owner', JSON.stringify(stored));
  m.approve.mockImplementation(async () => { target.teamId = team.id; return true; });
  expect((await call('session_stop', { session_id: target.id })).isError).toBe(true); expect(m.cancel).not.toHaveBeenCalled();
});
it('PA-TOOLS-02 F UI Stop Team also cancels a pending PA approval before any core team exists', async () => {
  const { stopTeam, stopTeamState } = await import('@/features/teams/actions/teams');
  const stored = JSON.parse(localStorage.getItem('lom.personal.v1:owner')!); stored.items[0].permission = 'ask'; localStorage.setItem('lom.personal.v1:owner', JSON.stringify(stored));
  m.approve.mockImplementation(async () => { expect(stopTeamState(team).enabled).toBe(true); stopTeam(team.id); return true; });
  expect((await call('personal_team_send', { team_id: team.id, text: 'pending' })).isError).toBe(true); expect(m.send).not.toHaveBeenCalled();
});

function addPhone() {
  team.members.push({ mid: 'mobile', agent: 'dev_mobile', role: '手机' });
  S.agents.dev_mobile = { name: 'Phone', kind: 'phone', real: true, status: 'online' } as typeof S.agents[string];
  m.phoneStop.mockResolvedValue(true);
  m.phoneSend.mockImplementation(async (c: Conv) => { c.phoneSession = 'accepted-phone'; S.running[c.id] = true; });
}
it('PA-TEAM-01 direct phone dispatch before core creation remains stoppable and blocks reconfiguration', async () => {
  addPhone();
  expect(value(await call('personal_team_send', { team_id: team.id, member_id: 'mobile', text: 'work' }))).toMatchObject({ status: 'accepted' });
  expect(team.core).toBeUndefined(); expect(team.leaderConv).toBeUndefined();
  const child = S.convs.find(c => c.owner === 'dev_mobile')!;
  expect((await call('personal_team_configure', { team_id: team.id, name: 'No' })).isError).toBe(true);
  const { stopTeamState } = await import('@/features/teams/actions/teams');
  expect(stopTeamState(team).enabled).toBe(true);
  expect(value(await call('personal_team_stop', { team_id: team.id }))).toMatchObject({ status: 'stopped', phones_confirmed: 1 });
  expect(m.phoneStop).toHaveBeenCalledWith(child);
});
it('PA-TEAM-01 stop waits for direct phone admission and cancels its late accepted task', async () => {
  addPhone(); let resume!: () => void;
  m.phoneSend.mockImplementation(async (c: Conv) => {
    await new Promise<void>(resolve => { resume = resolve; });
    c.phoneSession = 'late-phone'; S.running[c.id] = true;
  });
  const sending = call('personal_team_send', { team_id: team.id, member_id: 'mobile', text: 'work' });
  await vi.waitFor(() => expect(resume).toBeTypeOf('function'));
  const stopping = call('personal_team_stop', { team_id: team.id });
  await Promise.resolve(); await Promise.resolve();
  expect(m.phoneStop).not.toHaveBeenCalled();
  resume(); expect((await sending).isError).toBe(true);
  expect(value(await stopping)).toMatchObject({ status: 'stopped', phones_confirmed: 1 });
  expect(m.phoneStop).toHaveBeenCalledWith(expect.objectContaining({ phoneSession: 'late-phone' }));
});
it('PA-TEAM-01 an uncertain direct phone admission never becomes a successful stop', async () => {
  addPhone();
  m.phoneSend.mockRejectedValue(new Error('phone request outcome unknown'));
  expect((await call('personal_team_send', { team_id: team.id, member_id: 'mobile', text: 'work' })).isError).toBe(true);
  m.phoneStop.mockRejectedValue(new Error('phone send pending'));
  expect((await call('personal_team_stop', { team_id: team.id })).isError).toBe(true);
});
