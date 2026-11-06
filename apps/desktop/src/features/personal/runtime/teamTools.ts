import { workspaceRequired } from '@/features/workspace/runtime/required';
import { stopTeamPhones, teamPhoneConversations } from '@/features/teams/runtime/phoneLifecycle';
import { api } from '@/core/client';
import type { CommanderCall } from '@/core/remoteWire';
import { authAccount } from '@/features/account/runtime/authScope';
import { stopTask, isTaskStopping } from '@/features/chat/runtime/cancel';
import { stopCoreTeam } from '@/features/teams/runtime/coreTeam';
import { createTeamConfiguration } from '@/features/teams/runtime/configuration';
import { teamEpoch, invalidateTeamOperations, beginTeamOperation, observedTeamRun } from '@/features/teams/runtime/teamGuard';
import { conversationOf, memberInfo, sendToTeam } from '@/features/teams/runtime/team';
import { resolveTeamRecipients } from '@/features/teams/runtime/messageRoute';
import { assistantDispatchMeta } from '@/features/teams/chat/chain';
import { teamMemberCapabilities } from './teamMemberCapabilities';
import { registerPhoneReceipt } from './phoneReceipt';
import { agentState } from '@/features/settings/runtime/agentState';
import { S, update } from '@/state/store';
import type { Conv, Team, TeamMember } from '@/state/types';
import { personalFullAccess, personalPermissionAssistant } from './permissions';
import { approveCapability } from './capabilityApproval';
import { requestPersonalToolApproval } from './feishuApprovals';
import { dispatchOnce } from './sessionDispatch';
import { switchMemberModel } from './teamMemberModel';
import { checkedModel, describeAgentModel } from './agentModels';
import { registerDispatchHook } from './dispatchHook';
import { duplicateAgeMinutes, recentSend, rememberSend } from './teamSendDedup';
import type { Result } from './sessionTools';

export const TEAM_TOOLS = ['personal_team_create', 'personal_team_configure', 'personal_team_read', 'personal_team_send', 'personal_team_stop', 'personal_team_member_model', 'personal_agent_configure', 'session_stop'];
const ok = (value: unknown): Result => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const text = (v: unknown, max: number) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`文本须为1至${max}字`); return v.trim(); };
const fields = (a: Record<string, unknown>, allowed: string[]) => { if (Object.keys(a).some(k => !allowed.includes(k))) throw new Error('personal.team_arguments：不支持指定账号、路径、权限或未知字段'); };
const configured = (t: Team) => ({ status: 'configured_in_memory', team_id: t.id, name: t.name, core_created: false,
  member_models: t.members.map(m => ({ member_id: m.mid, model: m.model ?? 'auto' })), note: '已更新桌面配置，尚未启动；磁盘持久化沿用现有桌面偏好机制，未独立验证。' });
const assertLive = (current: () => boolean) => { if (!current()) throw new Error('助理已停止、账号、权限或目标已变化；已发出请求请核对，不自动重试'); };

/** 只有电脑上的外部 Agent 成员能指定模型；Lom 沿用桌面当前模型，手机没有模型选择。 */
function memberModel(agent: string, value: unknown) {
  if (value === undefined || value === 'auto') return undefined;
  if (!agent.startsWith('ag:')) throw new Error('只有电脑上的外部 Agent 成员能指定 model；Lom 沿用桌面当前模型，手机不支持');
  return checkedModel(agent.slice(3), value);
}
async function agentConfigure(self: Conv, args: Record<string, unknown>, current: () => boolean): Promise<Result> {
  fields(args, ['agent_id', 'model']); const id = text(args.agent_id, 160), row = S.agentCatalog?.find(a => a.id === id);
  if (!row || !row.enabled) throw new Error('找不到已启用的电脑 Agent，请先 personal_targets(kind=agents) 核对');
  if (args.model === undefined) return ok(describeAgentModel(id));
  const model = checkedModel(id, args.model);
  await approve(self, `把 Agent「${row.name}」之后新任务和新团队默认使用的模型改为${model ?? '它自己的当前默认（auto）'}。`, current);
  update(s => { if (model) s.agentModelPick[id] = model; else delete s.agentModelPick[id]; });
  return ok({ status: 'saved_in_desktop_preference', ...describeAgentModel(id), note: '只影响之后新建的任务和团队；已开工的成员请在团队界面或成员会话里切换。' });
}
function roster(input: unknown): TeamMember[] {
  if (!Array.isArray(input) || !input.length || input.length > 12) throw new Error('团队须有1至12位真实成员');
  const members = input.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('成员参数必须是对象');
    fields(value, ['agent_id', 'role', 'leader', 'model']);
    if (value.leader !== undefined && typeof value.leader !== 'boolean') throw new Error('leader 必须为布尔值');
    const id = text(value.agent_id, 160), role = text(value.role, 80);
    let agent: string;
    if (id === 'lom') agent = 'pc';
    else {
      const row = S.agentCatalog?.find(a => a.id === id);
      if (row) { if (!row.enabled || agentState(row) !== 'ok') throw new Error('电脑 Agent 未检测可用，请先在设置中测试连接'); agent = `ag:${id}`; }
      else if (S.agents[id]?.real && S.agents[id].kind === 'phone') agent = id;
      else throw new Error('找不到真实成员，请先 personal_targets 核对');
    }
    const model = memberModel(agent, (value as Record<string, unknown>).model);
    return { mid: crypto.randomUUID(), agent, role, leader: value.leader === true, ...(model ? { model } : {}) };
  });
  if (members.filter(m => m.agent === 'pc').length > 1) throw new Error('Lom 只能加入一次');
  const leaders = members.filter(m => m.leader);
  if (leaders.length !== 1 || !(leaders[0].agent === 'pc' || leaders[0].agent.startsWith('ag:'))) throw new Error('须明确指定一位电脑成员为 Leader');
  return members;
}
function owned(id: unknown) {
  const t = S.teams.find(t => t.id === id && t.real && t.ownerAccountId === S.account?.id);
  if (!t) throw new Error('找不到归属当前账号的真实团队；旧版无归属记录不能自动认领');
  return t;
}
function unique(name: string, except?: Team) {
  if (S.teams.some(t => t !== except && t.ownerAccountId === S.account?.id && t.name === name)) throw new Error('已有同名团队，请先核对，未重复创建');
}
function targetGuard(t: Team, current: () => boolean, freezeCore = false, checkEpoch = true) {
  const signature = JSON.stringify([t.name, t.folder, t.members]), epoch = teamEpoch(t), core = t.core?.id;
  return () => current() && S.teams.includes(t) && t.ownerAccountId === S.account?.id && t.real === true
    && JSON.stringify([t.name, t.folder, t.members]) === signature && (!checkEpoch || teamEpoch(t) === epoch) && (!freezeCore || t.core?.id === core);
}
async function approve(self: Conv, summary: string, current: () => boolean) {
  assertLive(current);
  if (!personalFullAccess(self)) {
    const allowed = self.messages.findLast(m => m.type === 'user')?.source === 'feishu'
      ? await requestPersonalToolApproval(self, summary, current) : await approveCapability(summary, current);
    if (!allowed) throw new Error('未批准操作');
  }
  assertLive(current);
}
async function read(t: Team, current: () => boolean) {
  let status = 'configured', run: string | null = null;
  if (t.core) {
    const st = await api<{ active_run?: { team_run_id?: string } | null }>('GET', `/api/teams/${encodeURIComponent(t.core.id)}/run-state`, undefined, { timeoutMs: 5000 });
    assertLive(current);
    run = observedTeamRun(st); status = run ? 'running' : 'idle';
  }
  const members = await teamMemberCapabilities(t, current);
  return ok({ team_id: t.id, name: t.name.slice(0, 160), status, team_run_id: run, total_members: t.members.length,
    members,
    truncated: t.members.length > 12, note: '运行态不代表目标成功；使用 session_read/session_wait 核对成员真实结果。' });
}
async function manage(self: Conv, call: CommanderCall, args: Record<string, unknown>, current: () => boolean): Promise<Result> {
  if (call.name === 'personal_team_create') {
    fields(args, ['name', 'members']); const name = text(args.name, 80), members = roster(args.members); unique(name);
    const folder = self.workspace || self.personal?.directory; if (!folder) throw workspaceRequired('助理');
    await approve(self, `创建团队「${name}」，${members.length}位成员；只建立配置，不派活、不继承助理权限。`, current);
    unique(name); roster(args.members);
    const t = createTeamConfiguration({ name, folder, members, real: true });
    return ok(configured(t));
  }
  const t = owned(args.team_id), live = targetGuard(t, current, call.name === 'personal_team_read' || call.name === 'personal_team_stop');
  if (call.name === 'personal_team_read') { fields(args, ['team_id']); return read(t, live); }
  if (call.name === 'personal_team_configure') {
    fields(args, ['team_id', 'name', 'members']); if (t.core || t.leaderConv || Object.keys(t.memberConvs || {}).length) throw new Error('团队已经开工，请先停止并在团队界面修改成员；不会重建或删除已有会话');
    const name = args.name === undefined ? t.name : text(args.name, 80), members = args.members === undefined ? t.members : roster(args.members); unique(name, t);
    await approve(self, `配置团队「${name}」及${members.length}位成员，不启动任务。`, live);
    if (t.core || t.leaderConv || Object.keys(t.memberConvs || {}).length) throw new Error('团队已开工，未覆盖配置');
    unique(name, t); if (args.members !== undefined) roster(args.members);
    update(() => { t.name = name; t.members = members; }); return ok(configured(t));
  }
  if (call.name === 'personal_team_member_model') {
    fields(args, ['team_id', 'member_id', 'model']);
    return ok(await switchMemberModel(t, args.member_id === undefined ? undefined : text(args.member_id, 160), args.model, summary => approve(self, summary, live), live));
  }
  if (call.name === 'personal_team_stop') {
    fields(args, ['team_id']); await approve(self, `停止团队「${t.name}」的当前任务。`, live);
    invalidateTeamOperations(t);
    const afterStop = targetGuard(t, current, true, false);
    if (!t.core && !t.leaderConv) {
      const started = teamPhoneConversations(t).length > 0;
      const phones = await stopTeamPhones(t, afterStop);
      return ok({ team_id: t.id, status: started ? 'stopped' : 'configured', phones_confirmed: phones });
    }
    if (!t.core) {
      const [stopped, phones] = await Promise.all([stopTask(t.leaderConv!), stopTeamPhones(t, afterStop)]);
      if (!stopped) throw new Error('团队停止尚未确认');
      assertLive(afterStop); return ok({ team_id: t.id, status: 'stopped', phones_confirmed: phones });
    }
    const r = await stopCoreTeam(t, afterStop); assertLive(afterStop);
    return ok({ team_id: t.id, status: r?.stopped ? 'cancel_requested' : 'idle', phones_confirmed: r?.phones ?? 0, note: '核心取消回执不代表全部成员已结束，请用 personal_team_read 核对。' });
  }
  return send(self, t, args, live);
}
function memberAvailable(m: TeamMember) {
  if (m.agent === 'pc') return true;
  if (m.agent.startsWith('ag:')) { const a = S.agentCatalog?.find(a => `ag:${a.id}` === m.agent); return !!a && a.enabled && agentState(a) === 'ok'; }
  return S.agents[m.agent]?.real === true && S.agents[m.agent].kind === 'phone';
}
async function send(self: Conv, t: Team, args: Record<string, unknown>, current: () => boolean) {
  fields(args, ['team_id', 'member_id', 'text']); const message = text(args.text, 20_000);
  const [member] = resolveTeamRecipients(t, { kind: 'direct', memberId: args.member_id === undefined ? undefined : text(args.member_id, 160) });
  const live = () => current() && memberAvailable(member) && (member.agent === 'pc' || member.agent.startsWith('ag:') || S.agents[member.agent]?.status === 'online')
    && (!!t.core || t.members.every(memberAvailable));
  assertLive(live);
  if (t.core?.pendingSync) throw new Error('团队成员待同步，请先在团队界面核对');
  // 同样的派活正文短时间内只投递一次：催单/重发不能把同一份任务书灌进目标上下文多遍。
  const earlier = recentSend(t.id, member.mid, message);
  if (earlier) return ok({ status: 'duplicate', team_id: t.id, member_id: member.mid, session_id: earlier.sessionId,
    note: `同样内容约 ${duplicateAgeMinutes(earlier)} 分钟前已经投递给该成员，这次没有重复投递。请用 session_wait/session_read 查看进展；确需再发请改写内容。` });
  const release = beginTeamOperation(t);
  try {
    // 先核对目标的真实状态，再请用户批准，避免批完才发现根本派不出去。
    const target = conversationOf(t, member);
    if (target && (isTaskStopping(target.id) || ((member.leader || target.owner !== 'pc') && S.running[target.id]))) throw new Error('目标成员正在执行或停止，请先查看状态');
    if (member.leader && t.core) {
      const observed = await api<{ active_run?: { team_run_id?: string } | null }>('GET', `/api/teams/${encodeURIComponent(t.core.id)}/run-state`, undefined, { timeoutMs: 5000 });
      if (observedTeamRun(observed)) throw new Error('核心团队正在运行，请先读取结果');
    }
    const chat = assistantDispatchMeta(t, self, member); // 群聊里的助理：带上协作链，超过跳数上限直接拒绝（TEAM-CHAT-01B）
    await approve(self, `给团队「${t.name}」的${member.leader ? '队长 ' : '成员 '}${memberInfo(member.agent).name}发送：${message}`, live);
    assertLive(live);
    const armedAt = Date.now();
    if (!await sendToTeam(t, member, message, [], live, chat)) throw new Error('团队派发未确认；请打开团队核对，未自动重试');
    const accepted = conversationOf(t, member);
    if (live() && accepted && accepted.owner !== 'pc') registerPhoneReceipt(self, accepted, armedAt);
    else if (live() && accepted) registerDispatchHook(self, accepted, armedAt);
    assertLive(live);
    const sessionId = accepted?.id ?? (member.leader ? t.leaderConv : t.memberConvs?.[member.mid]);
    rememberSend(t.id, member.mid, message, sessionId, armedAt);
    return ok({ status: 'accepted', team_id: t.id, member_id: member.mid,
      session_id: sessionId, note: '已接受不等于完成；请用 session_wait/session_read 核对。' });
  } finally { release(); }
}
function ordinary(target: Conv, self: Conv) {
  return target !== self && !target.personal && !target.sideOf && !target.teamId
    && !S.teams.some(t => t.leaderConv === target.id || Object.values(t.memberConvs || {}).includes(target.id));
}

export async function executeTeamTool(self: Conv, call: CommanderCall, current: () => boolean): Promise<Result> {
  const user = self.messages.findLast(m => m.type === 'user');
  const accountCurrent = authAccount(), profile = personalPermissionAssistant(self), tier = profile?.permission;
  const live = () => current() && accountCurrent() && !!profile && !personalPermissionAssistant(self)?.permissionPending && personalPermissionAssistant(self)?.permission === tier && self.messages.findLast(m => m.type === 'user') === user;
  try {
    assertLive(live); if (!TEAM_TOOLS.includes(call.name)) throw new Error('未知团队工具');
    const args = JSON.parse(call.arguments || '{}'); if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('参数必须是对象');
    if (call.name === 'session_stop') {
      fields(args, ['session_id']); const target = S.convs.find(c => c.id === args.session_id && c !== self && !c.personal && !c.sideOf);
      if (!target) throw new Error('找不到可停止的会话'); if (!ordinary(target, self)) throw new Error('请用 personal_team_stop 停止所属团队');
      return await dispatchOnce(call, `stop:${target.id}`, live, async () => {
        const valid = () => live() && S.convs.includes(target) && target.id === args.session_id && ordinary(target, self);
        await approve(self, `停止会话「${target.title.slice(0, 160)}」`, valid);
        if (!await stopTask(target.id)) throw new Error('会话停止尚未确认，请打开会话核对'); assertLive(valid); return ok({ status: 'stopped', session_id: target.id });
      });
    }
    if (call.name === 'personal_agent_configure') return args.model === undefined ? await agentConfigure(self, args, live) : await dispatchOnce(call, `agent-model:${String(args.agent_id)}`, live, () => agentConfigure(self, args, live));
    if (call.name === 'personal_team_read') return await manage(self, call, args, live);
    const lock = call.name === 'personal_team_create' ? `team-create:${S.account?.id}` : `${call.name === 'personal_team_stop' ? 'stop:' : ''}team:${String(args.team_id)}`;
    return await dispatchOnce(call, lock, live, () => manage(self, call, args, live));
  } catch (e) { return { isError: true, content: [{ type: 'text', text: live() ? (e instanceof Error ? e.message : '团队操作失败，请核对实际状态') : '助理已停止、账号或权限已变化；结果未交付，已发出的请求请核对。' }] }; }
}
