import { stopMonitoring } from '@/features/phones/runtime/collaborationSettings';
import { stopTeamPhones } from './phoneLifecycle';
import { attachMemberPhoneBridges } from './memberPhoneBridge';
import { invalidateDelegations, stopDelegationAdmissions } from './delegationLifecycle';
import { expandContextFiles } from '@/shared/lib/contextFiles';
import { ensureLomSelection } from '@/features/account/runtime/cloud';
import { ensureTaskModel } from '@/features/chat/runtime/taskModel';
import { authAccount } from '@/features/account/runtime/authScope';
import { teamRequest, teamAlways, assertTeamCurrent, teamStep, invalidateTeamOperations, observedTeamRun } from './teamGuard';
import { convFromCore } from '@/features/chat/runtime/history';
import { EXCLUDED_AUTO_SKILLS, taskRules } from '@/features/settings/runtime/agentRules';
import { COMMANDER_RULES, commanderExtra, ensurePhoneBridge } from '@/features/phones/runtime/phoneCommander';
import { effectiveMode, publicationPolicy } from '@/features/settings/runtime/preferences';
import { AGENT_PREFIX, conversationOf, isLegacyLeaderAlias, isAgentMember, leaderMember, memberAgentRow, memberInfo, phonesOf, teamFolder, teamRules } from './team';
import { currentPcModel, modelChoice } from '@/state/selectors';
import { S, update } from '@/state/store';
import type { Attachment, CoreTeamLink, DraftAttachment, Msg, Team, TeamChatMeta, TeamMember } from '@/state/types';
import { messageEnvelope } from '@/features/chat/runtime/channelSource';
import type { CoreConversation } from '@/core/types';
import { uid } from '@/shared/lib/util';
import { memberModelFor } from '@/features/personal/runtime/agentModels';
import { sendBlocker } from '@/features/chat/runtime/turnLedger';
import { sendReceipt } from '@/features/chat/runtime/sendReceipt';

/* ===== OPC 团队跑在内核自带的团队模式上（lom-core 的 aionui-team）=====
 * Leader：按所选电脑 Agent 创建专用助手，继承其引擎，附加团队规则和手机工具。
 * 成员：本机 Agent（Codex CLI、Kimi……）。成员之间用内核的 team_send_message 直接发消息、team_task_* 分派任务；
 * 收到消息的成员由内核唤醒处理，不要求回复。手机不是内核成员，仍由 Leader 用 phone_* 工具指挥。 */

interface CoreSlot { slot_id: string; name: string; role: string; conversation_id: string }
interface CoreTeam { id: string; assistants: CoreSlot[] }
interface AssistantRow { id: string; source?: string; agent_id?: string; agent?: { type?: string } }

const desktopMembers = (t: Team) => t.members.filter(m => !m.leader && !isLegacyLeaderAlias(t, m) && (m.agent === 'pc' || (isAgentMember(m.agent) && memberAgentRow(m.agent))));

/** 内核里的成员名：用 Agent 的名字（成员之间互相称呼）；同一种 Agent 有两个时带上角色区分，
 *  角色也相同再按加入顺序编号。名字必须一人一个，否则两个成员会认领到同一个内核成员、共用一条会话。 */
export function coreName(t: Team, m: TeamMember) {
  const name = memberInfo(m.agent).name;
  const same = t.members.filter(x => !isLegacyLeaderAlias(t, x) && (x.agent === 'pc' || isAgentMember(x.agent)) && memberInfo(x.agent).name === name);
  if (same.length < 2) return name;
  const sameRole = same.filter(x => x.role === m.role);
  return sameRole.length < 2 ? `${name}·${m.role}` : `${name}·${m.role}${sameRole.findIndex(x => x.mid === m.mid) + 1}`;
}
const nativeEngine = async (current: () => boolean) => {
  const list = await teamRequest<AssistantRow[]>(current, 'GET', '/api/assistants');
  const id = list.find(a => a.source === 'generated' && a.agent?.type === 'aionrs')?.agent_id;
  if (!id) throw new Error('内核里找不到 Lom 引擎，无法添加 Lom 成员');
  return id;
};
const agentInput = async (t: Team, m: TeamMember, current: () => boolean) => {
  if (m.agent === 'pc') {
    await teamStep(current, () => ensureLomSelection(S.model));
    const model = currentPcModel();
    if (!model?.providerId || !model.model) throw new Error('请先为 Lom 成员配置模型');
    return { assistant_id: `bare:${await nativeEngine(current)}`, name: coreName(t, m), role: 'teammate', model: model.model };
  }
  const id = m.agent.slice(AGENT_PREFIX.length);
  return { assistant_id: `bare:${id}`, name: coreName(t, m), role: 'teammate', model: memberModelFor(id, m.model) };
};

/** Leader 的规则：Lom 身份 + 指挥手机 + 团队规则 */
const leaderRules = (t: Team) => {
  const signedIn = S.cloud === 'signed-in';
  const rules = [signedIn ? COMMANDER_RULES : '', teamRules(t)].filter(Boolean).join('\n\n');
  return leaderMember(t).agent === 'pc' ? taskRules(signedIn, rules) : rules;
};
const writeLeaderRules = (t: Team, assistant: string, current: () => boolean) => teamRequest(current, 'POST', '/api/skills/assistant-rule/write', { assistant_id: assistant, content: leaderRules(t) });

/** Leader 的工具：这个团队专用的手机工具（含看图、派活）；没登录又没有手机成员时只带用户开启的 MCP */
async function leaderTools(t: Team, current: () => boolean): Promise<{ scope?: string; mcp: string[] }> {
  try {
    const x = await teamStep(current, () => commanderExtra(current));
    return { scope: x.lom_phone_scope, mcp: x.selected_mcp_server_ids };
  } catch (e) {
    if (phonesOf(t).length) throw e;
    console.warn('team.phone_tools_skipped', e instanceof Error ? e.message : e);
    const all = await teamRequest<{ id: string; enabled: boolean; name: string }[]>(current, 'GET', '/api/mcp/servers');
    return { mcp: all.filter(x => x.enabled && !x.name.startsWith('lom-phone-')).map(x => x.id) };
  }
}

async function leaderAssistant(t: Team, mcp: string[], current: () => boolean) {
  const member = leaderMember(t), row = memberAgentRow(member.agent);
  if (member.agent !== 'pc' && (!row?.installed || row.status === 'missing')) throw new Error('主控 Agent 不可用，请到设置检查安装状态');
  const engine = member.agent === 'pc' ? await nativeEngine(current) : row!.id;
  const a = await teamRequest<{ id: string }>(current, 'POST', '/api/assistants', {
    name: `${memberInfo(member.agent).name} 主控 · ${t.name}`, description: `OPC 团队「${t.name}」的 Leader，由 Lom 自动创建`, agent_id: engine,
    disabled_builtin_skills: EXCLUDED_AUTO_SKILLS, defaults: { mcps: { mode: 'fixed', value: mcp }, skills: { mode: 'auto' } },
  });
  await writeLeaderRules(t, a.id, current);
  return a.id;
}

const restartSession = async (id: string, current: () => boolean) => { await teamRequest(current, 'DELETE', `/api/teams/${id}/session`); await teamRequest(current, 'POST', `/api/teams/${id}/session`, {}); };
/** 团队里某个成员换了模型：内核会结束它的运行时，重启团队会话让它按新模型重新接上 */
export const restartCoreSession = (core: CoreTeamLink, current = teamAlways) => restartSession(core.id, current).then(() => { modeSet.delete(core.id); });

/** 把内核团队里的会话放进任务列表（团队会话不出现在「最近任务」里） */
async function adopt(t: Team, ids: string[], current: () => boolean) {
  await Promise.all(ids.map(id => teamRequest(current, 'PATCH', `/api/conversations/${id}`, { extra: { lom_team: t.id } })));
  const rows = await Promise.all(ids.map(id => teamRequest<CoreConversation>(current, 'GET', `/api/conversations/${id}`)));
  update(s => {
    for (const row of rows) {
      const c = { ...convFromCore(row), teamId: t.id, loaded: true, messages: [] as Msg[] };
      const old = s.convs.find(x => x.id === c.id);
      if (old) Object.assign(old, { ...c, messages: old.messages, loaded: old.loaded }); else s.convs.push(c);
    }
  });
}

/** Native members need an exact provider, even when an external Agent leads the team. */
async function applyNativeMemberModel(member: TeamMember, conversation: string, current: () => boolean) {
  if (member.agent !== 'pc') return false;
  const selected = currentPcModel();
  if (!selected?.providerId || !selected.model) throw new Error('Lom 成员模型不可用');
  await teamRequest(current, 'PATCH', `/api/conversations/${conversation}`, { model: { provider_id: selected.providerId, model: selected.model }, extra: { ...(selected.lomTier ? { lom_tier: selected.lomTier } : {}) } });
  return true;
}

async function createCoreTeam(t: Team, current: () => boolean): Promise<CoreTeamLink> {
  const leader = leaderMember(t), native = leader.agent === 'pc';
  if (native) await teamStep(current, () => ensureLomSelection(S.model));
  const m = native ? currentPcModel() : undefined;
  if (native && (!m?.providerId || !m.model)) throw new Error('先添加一个模型服务，Leader 才能开始工作');
  const members = desktopMembers(t);
  const inputs = await Promise.all(members.map(x => agentInput(t, x, current)));
  const leadModel = native ? m!.model : memberModelFor(leader.agent.slice(AGENT_PREFIX.length), leader.model);
  const tools = await leaderTools(t, current);
  const assistant = await leaderAssistant(t, tools.mcp, current);
  let res: CoreTeam;
  try {
    res = await teamRequest<CoreTeam>(current, 'POST', '/api/teams', {
      name: t.name, workspace: teamFolder(t),
      agents: [{ assistant_id: assistant, name: coreName(t, leader), role: 'lead', model: leadModel }, ...inputs],
    });
  } catch (e) {
    if (current()) void teamRequest(current, 'DELETE', `/api/assistants/${assistant}`).catch(err => console.warn('team.assistant_cleanup_failed', err));
    throw e;
  }
  const link: CoreTeamLink = { id: res.id, slots: {}, assistant, ...(tools.scope ? { scope: tools.scope } : {}) };
  const convs: Record<string, string> = {};
  let lead: CoreSlot | undefined;
  try {
    lead = res.assistants.find(a => a.role === 'lead');
    if (!lead) throw new Error('内核团队没有返回 Leader');
    link.slots[leaderMember(t).mid] = lead.slot_id;
    const used = new Set<string>();
    for (const x of members) {
      // 已被别的成员认领的内核成员不再分配：即使重名，也不会两人共用一条会话
      const slot = res.assistants.find(a => a.role !== 'lead' && !used.has(a.slot_id) && a.name === coreName(t, x));
      if (!slot) throw new Error(`${coreName(t, x)} 没有加入内核团队`);
      used.add(slot.slot_id); link.slots[x.mid] = slot.slot_id; convs[x.mid] = slot.conversation_id;
    }
    // 内核按模型名找服务商：同名模型可能落到别的服务商，这里精确到当前选的；手机工具按 scope 对上 Leader 会话
    const row = await teamRequest<CoreConversation>(current, 'GET', `/api/conversations/${lead.conversation_id}`);
    const fix = !!m && (row.model?.provider_id !== m.providerId || row.model?.model !== m.model);
    await teamRequest(current, 'PATCH', `/api/conversations/${lead.conversation_id}`, { ...(fix ? { model: { provider_id: m!.providerId, model: m!.model } } : {}), extra: { ...(tools.scope ? { lom_phone_scope: tools.scope } : {}), ...(m?.lomTier ? { lom_tier: m.lomTier } : {}) } });
    let memberModelFixed = false;
    for (const member of members) {
      if (await applyNativeMemberModel(member, convs[member.mid], current)) memberModelFixed = true;
    }
    await adopt(t, [lead.conversation_id, ...Object.values(convs)], current);
    await attachMemberPhoneBridges(t, Object.values(convs), current);
    if (fix || memberModelFixed) await restartSession(res.id, current);
  } catch (e) {
    // 没组建完整：内核里的半成品删掉，下次发送重新组建
    if (current()) void removeCoreTeam(link, current).catch(err => console.warn('team.core_cleanup_failed', err));
    throw e;
  }
  const leadConv = lead.conversation_id;
  update(s => {
    t.core = link; t.leaderConv = leadConv; t.memberConvs = { ...(t.memberConvs || {}), ...convs }; t.rosterSent = undefined;
    s.convPhones[leadConv] = phonesOf(t);
  });
  checked.add(res.id);
  return link;
}

/** 本次运行里确认过还在的内核团队；重新打开 Lom 后第一次用时补登记手机工具 */
const checked = new Set<string>();
/** 同一个团队同时只组建 / 检查一次：两个窗格同时第一次发送时共用，失败后下次重来 */
const pending = new Map<string, Promise<CoreTeamLink>>();
export function ensureCoreTeam(t: Team, current = teamAlways): Promise<CoreTeamLink> {
  assertTeamCurrent(current);
  const run = pending.get(t.id);
  if (run) return teamStep(current, () => run);
  const next = ensureOnce(t, current).finally(() => pending.delete(t.id));
  pending.set(t.id, next);
  return next;
}
/** 修复旧版本建出的团队：同一个 Agent 加了两次且角色相同时，两个成员认领了同一个内核成员、共用一条会话。
 *  后加的成员改认领内核里同名、还没人用的那一位；找不到就解除映射，交给成员同步重新加入，各自一条会话。 */
function repairSharedSlots(t: Team, core: CoreTeamLink, remote: CoreTeam | undefined) {
  const lead = leaderMember(t).mid;
  const taken = new Set(Object.values(core.slots));
  const owner = new Set<string>();
  const fixes: [string, CoreSlot | undefined][] = [];
  for (const m of t.members) {
    const slot = core.slots[m.mid];
    if (!slot || m.mid === lead) continue;
    if (!owner.has(slot)) { owner.add(slot); continue; }
    const name = remote?.assistants?.find(a => a.slot_id === slot)?.name;
    const free = remote?.assistants?.find(a => a.role !== 'lead' && a.name === name && !taken.has(a.slot_id));
    if (free) { taken.add(free.slot_id); owner.add(free.slot_id); }
    fixes.push([m.mid, free]);
  }
  if (!fixes.length) return;
  console.warn('team.shared_slot_repaired', core.id, fixes.length);
  update(() => {
    for (const [mid, free] of fixes) {
      if (free) { core.slots[mid] = free.slot_id; (t.memberConvs ||= {})[mid] = free.conversation_id; }
      else { delete core.slots[mid]; if (t.memberConvs) delete t.memberConvs[mid]; core.pendingSync = true; }
    }
  });
}

async function ensureOnce(t: Team, current: () => boolean): Promise<CoreTeamLink> {
  const core = t.core;
  if (core && checked.has(core.id)) {
    if (core.pendingSync) await syncCoreMembers(t, current); // 上次成员同步没成功：先补上
    return core;
  }
  if (core) {
    let remote: CoreTeam | undefined;
    try { remote = await teamRequest<CoreTeam>(current, 'GET', `/api/teams/${core.id}`); }
    catch (e) {
      if ((e as { status?: number }).status !== 404) throw e;
      console.warn('team.core_missing', core.id);
      return createCoreTeam(t, current);
    }
    assertTeamCurrent(current);
    repairSharedSlots(t, core, remote);
    if (core.scope && S.cloud === 'signed-in') {
      try { if (await teamStep(current, () => ensurePhoneBridge(core.scope!, current))) await restartSession(core.id, current); }
      catch (e) { if (phonesOf(t).length) throw e; console.warn('team.phone_bridge_skipped', e instanceof Error ? e.message : e); }
    }
    if (core.pendingSync) await syncCoreMembers(t, current);
    else await bindExistingMemberPhones(t, current);
    checked.add(core.id);
    return core;
  }
  return createCoreTeam(t, current);
}

/** 权限模式：内核团队默认全自动，成员启动（预热）时会写回默认值，所以每次运行第一次发送前确认一次；成员还在启动就稍等重试 */
const modeSet = new Map<string, string>();
async function applyMode(core: CoreTeamLink, current = teamAlways) {
  const mode = effectiveMode(S.permission);
  if (modeSet.get(core.id) === mode) return;
  await teamRequest(current, 'POST', `/api/teams/${core.id}/session`, {});
  for (let i = 0; ; i++) {
    try { await teamRequest(current, 'POST', `/api/teams/${core.id}/session-mode`, { mode }); break; }
    catch (e) {
      if ((e as { status?: number }).status !== 409 || i >= 8) throw new Error(`团队的权限模式没有生效，已取消发送：${e instanceof Error ? e.message : String(e)}`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  modeSet.set(core.id, mode);
}
export const applyTeamMode = async (core: CoreTeamLink) => { modeSet.delete(core.id); await applyMode(core); };

const filesOf = (atts: DraftAttachment[]) => expandContextFiles(atts).filter(a => a.path).map(a => ({ kind: a.kind || 'local', path: a.path }));

/** The cached team may still hold a retired physical model. Confirm its leader before dispatch. */
async function ensureLeaderModel(t: Team, core: CoreTeamLink, current: () => boolean) {
  if (leaderMember(t).agent !== 'pc') return; // 外部 Agent 使用自身模型配置，不能被 Lom 模型覆盖。
  const c = conversationOf(t, leaderMember(t));
  if (!c) throw new Error('团队 Leader 会话不可用');
  await teamStep(current, () => ensureLomSelection(c.modelId || S.model));
  const selected = c.modelId ? modelChoice(c.modelId, c.lomTier) : currentPcModel();
  if (!selected || selected.unavailable) throw new Error('Leader 模型已失效或档位不明确，请重新选择');
  const changed = c.modelId !== `${selected.providerId}::${selected.model}`;
  if (changed && [c.id, ...Object.values(t.memberConvs || {})].some(id => S.running[id])) throw new Error('Leader 本轮仍在运行，请结束后再同步模型');
  await teamStep(current, () => ensureTaskModel(c, selected, current));
  if (changed) await restartSession(core.id, current);
}

/** 在团队窗格里发送：Leader 的窗格发给团队（内核交给 Leader），成员窗格直接发到这个成员的信箱 */
export async function sendToCoreTeam(t: Team, m: TeamMember, text: string, atts: DraftAttachment[], current = teamAlways, teamChat?: TeamChatMeta): Promise<boolean> {
  const accountCurrent = authAccount();
  const core = await ensureCoreTeam(t, current);
  const slot = core.slots[m.mid], c = conversationOf(t, m);
  if (!slot || !c) throw new Error('这个成员还没加入团队，请在「成员」里重新保存一次');
  // REFACTOR-01 模块 1：和普通任务同一套规则——停止未确认、上一条结果未知时不发新消息
  const blocked = sendBlocker(c.id);
  if (blocked) throw new Error(blocked);
  const wasRunning = !!S.running[c.id];
  let message: Msg | undefined;
  const receipt = sendReceipt(undefined);
  try {
    await ensureLeaderModel(t, core, current);
    await applyMode(core, current);
    const attachments: Attachment[] = atts.map(a => ({ name: a.name, ic: a.ic as Attachment['ic'], preview: a.preview, path: a.path, kind: a.kind, historyId: a.historyId, historyPaths: a.historyPaths }));
    const sent: Msg = { id: uid('m'), type: 'user', at: Date.now(), text, attachments, status: 'running', ...(teamChat ? { source: 'team_chat' as const, teamChat } : {}) };
    message = sent;
    update(s => { c.messages.push(sent); s.running[c.id] = true; c.updated = Date.now(); });
    const path = m.leader ? `/api/teams/${core.id}/messages` : `/api/teams/${core.id}/agents/${slot}/messages`;
    receipt.dispatched();
    await teamRequest(current, 'POST', path, { content: `${publicationPolicy()}\n\n${messageEnvelope(sent)}${text}`, files: filesOf(atts) });
    update(() => { sent.status = 'done'; });
    return true;
  } catch (e) {
    // 请求已发出、回执丢失：核心可能已经收到，不能报「发送失败」诱导重发
    const unknown = !receipt.safeFailure(e), reason = e instanceof Error ? e.message : String(e);
    if (!current() && (!message || !accountCurrent() || !S.convs.includes(c))) return false; // Only an admitted message in the same account can be marked unconfirmed.
    update(s => {
      if (!wasRunning) delete s.running[c.id];
      if (message) message.status = unknown ? 'unconfirmed' : 'error';
      c.messages.push({ id: uid('m'), type: 'system', at: Date.now(), text: unknown ? `发送结果未确认，请打开团队会话核对，未自动重发：${reason}` : `发送失败：${reason}`, ic: 'info' });
    });
    return false;
  }
}

/** 成员改了之后同步到内核团队：加进来的本机 Agent 入队，移走的出队，Leader 规则换成新名单 */
function bindExistingMemberPhones(t: Team, current: () => boolean) {
  const ids = desktopMembers(t).flatMap(m => {
    const id = t.memberConvs?.[m.mid];
    return id ? [id] : [];
  });
  return attachMemberPhoneBridges(t, ids, current);
}

export async function syncCoreMembers(t: Team, current = teamAlways) {
  assertTeamCurrent(current);
  const core = t.core;
  if (!core) return;
  // 先记下「待同步」：中途失败也不会丢，下次发送前自动补同步，直到两边一致
  update(() => { core.pendingSync = true; });
  const want = desktopMembers(t), lead = leaderMember(t).mid;
  for (const [mid, slot] of Object.entries(core.slots)) {
    if (mid === lead || want.some(x => x.mid === mid)) continue;
    await teamRequest(current, 'DELETE', `/api/teams/${core.id}/agents/${slot}`);
    update(() => { delete core.slots[mid]; if (t.memberConvs) delete t.memberConvs[mid]; });
  }
  for (const x of want.filter(x => !core.slots[x.mid])) {
    const a = await teamRequest<CoreSlot>(current, 'POST', `/api/teams/${core.id}/agents`, await agentInput(t, x, current));
    if (await applyNativeMemberModel(x, a.conversation_id, current)) await restartCoreSession(core, current);
    await adopt(t, [a.conversation_id], current);
    update(() => { core.slots[x.mid] = a.slot_id; (t.memberConvs ||= {})[x.mid] = a.conversation_id; });
  }
  await bindExistingMemberPhones(t, current);
  await writeLeaderRules(t, core.assistant, current);
  update(s => { if (t.leaderConv) s.convPhones[t.leaderConv] = phonesOf(t); core.pendingSync = false; });
}

/** 停止团队：取消内核里这一轮团队运行（所有成员一起停），再停 Leader 派给手机的任务 */
export async function stopCoreTeam(t: Team, current = teamAlways) {
  assertTeamCurrent(current);
  invalidateTeamOperations(t);
  const core = t.core;
  if (!core) return { stopped: false, phones: await stopTeamPhones(t, current) };
  const parents = [...new Set([t.leaderConv, ...desktopMembers(t).map(m => t.memberConvs?.[m.mid])].filter((id): id is string => !!id))];
  parents.forEach(invalidateDelegations);
  parents.forEach(stopMonitoring);
  const st = await teamRequest<{ active_run?: { team_run_id?: string } | null }>(current, 'GET', `/api/teams/${core.id}/run-state`);
  const run = observedTeamRun(st);
  if (run) await teamRequest(current, 'POST', `/api/teams/${core.id}/runs/${encodeURIComponent(run)}/cancel`, { reason: '用户停止团队' });
  assertTeamCurrent(current);
  await teamStep(current, () => Promise.all(parents.map(stopDelegationAdmissions)));
  const phones = await stopTeamPhones(t, current);
  return { stopped: !!run, phones };
}

/** 解散团队：内核团队和专用的 Leader 助手一起删掉 */
export async function removeCoreTeam(core: CoreTeamLink, current = teamAlways) {
  try { await teamRequest(current, 'DELETE', `/api/teams/${core.id}`); }
  catch (e) { if ((e as { status?: number }).status !== 404) throw e; } // 内核里已经没有了：算删除成功
  await teamRequest(current, 'DELETE', `/api/assistants/${core.assistant}`).catch(e => console.warn('team.assistant_cleanup_failed', e));
}


/** 收到的团队成员消息（team_system 是内核的空闲通知等，不显示） */
export function teammateMsg(id: string, at: number, from: unknown, text: unknown): Msg | null {
  const name = String(from || ''), body = String(text || '').trim();
  if (!name || name === 'team_system' || !body) return null;
  return { id, type: 'teammate', at, agent: name, text: body };
}
