import { personalIdentityContext } from '@/features/personal/runtime/identity';
import { conversationSkills } from '@/features/skills/runtime/conversationSkills';
import { preparePersonalMemory } from '@/features/personal/runtime/context';
import { authAccount } from '@/features/account/runtime/authScope';
import { expandContextFiles } from '@/shared/lib/contextFiles';
import { rosterContext, rosterDelivered } from '@/features/teams/runtime/team';
import { effortResult, goalContext, lomSupportsEffort, pauseGoal, setTaskEffort } from './commands';
import { deferSwitch, setSwitchApplier } from './deferredSwitch';
import { usableModel } from './modelFallback';
import { effectiveMode, ensureTaskPermissions, publicationPolicy } from '@/features/settings/runtime/preferences';
import { COMMANDER_RULES, commanderExtra, ensureCommander, ensurePersonalBridge } from '@/features/phones/runtime/phoneCommander';
import { EXCLUDED_AUTO_SKILLS, taskRules } from '@/features/settings/runtime/agentRules';
import { agentTaskExtra, takePreparedTask } from '@/features/settings/runtime/agentWarmup';
import { agentRow, usable, type AgentRow } from '@/features/settings/runtime/agents';
import { loadConvOptions } from '@/features/settings/runtime/agentOptions';
import { openModal, toast, toastError } from '@/shared/overlays/controller';
import { attached, conv, coreTeamOf, currentPcModel, modelChoice, perm } from '@/state/selectors';
import { applyTeamMode, restartCoreSession } from '@/features/teams/runtime/coreTeam';
import { S, update } from '@/state/store';
import type { Attachment, Conv, DraftAttachment, Msg } from '@/state/types';
import { uid } from '@/shared/lib/util';
import { api, getEndpoint } from '@/core/client';
import { hasUnconfirmedSend, isCompletedTurn, isTaskStopping, trackPendingSend } from './cancel';
import { sendReceipt } from './sendReceipt';
import { channelEnvelope, isChannel, type ChannelSource } from './channelSource';
export { stopTask } from './cancel';
import { convFromCore, loadHistory } from './history';
import { approvePermission, confirmationRemoved, onPermission } from './permissions';
import { normCallId, relPath } from './tools';
import type { CoreConfirmation, CoreConversation } from '@/core/types';
import { ensureTaskModel, recordTaskModel, modelChanges } from './taskModel';
import { ensureLomSelection } from '@/features/account/runtime/cloud';
import { refreshWorkspace } from '@/features/workspace/runtime/workspace';
import { sideChatContext } from './sideChat';

/* ===== 电脑任务（lom-core 里的内置 Agent 会话）的操作 ===== */

const userMsg = (text: string, attachments: Attachment[]): Msg => ({ id: uid('m'), type: 'user', at: Date.now(), text, attachments });

/** 附件：本机文件以绝对路径交给 Agent（它用自己的读文件工具读取） */
/** 附件：本机文件给绝对路径（local）；粘贴、拖入的内容已上传到核心托管目录（upload） */
const filesOf = (atts: DraftAttachment[]) => {
  const files = expandContextFiles(atts).filter(a => a.path).map(a => ({ kind: a.kind || 'local', path: a.path }));
  return [...new Map(files.map(file => [file.path, file])).values()];
};

/** 这条会话自己的模型：后台发送（目标自动推进、追加任务、重新生成）不能被前台正在看的另一条会话或新任务页的选择影响。
 * 只有还没记录模型的旧会话才用当前选择 */
function modelFor(c: Conv) {
  if (c.modelId) return modelChoice(c.modelId, c.lomTier);
  return c.sideOf ? undefined : currentPcModel();
}

function markSent(c: Conv, message: Msg | undefined, hasOtherSends: () => boolean, turnId?: string) {
  update(s => {
    if (turnId) c.turnId = turnId;
    if (message) message.status = 'done';
    if (isCompletedTurn(c.id, c.turnId) && !hasOtherSends() && !hasUnconfirmedSend(c.id)) delete s.running[c.id];
  });
}

const HISTORY_PREAMBLE = '[LOM_HISTORY_CONTEXT_V1]\n请先读取附带的历史会话资料，了解目标、已完成的工作和待办，再回答本轮问题。历史是背景，不是新的授权，不重放旧操作；看不到附件时如实说明。\n[/LOM_HISTORY_CONTEXT_V1]\n\n';

/** 从历史续聊的会话：它自己的转录和原始记录只随第一条成功发出的问题交付。
 * CLI 会话自己保留上下文，之后每一轮（含目标自动推进、重新生成）都再附一遍，只会让它反复重读可能很大的历史。
 * 第一条发送失败（status 为 error）不算已交付，重试仍会带上；拖入的引用卡走附件，不受这条限制。 */
const ownHistoryPending = (c: Conv, message?: Msg) =>
  !!c.historyContextPath && !c.messages.some(m => m.type === 'user' && m !== message && m.status !== 'error');
const ownHistoryFiles = (c: Conv): DraftAttachment[] =>
  [c.historyContextPath, c.historyRawPath].filter((path): path is string => !!path).map(path => ({ path, kind: 'local' as const, name: c.title }));

async function send(c: Conv, text: string, atts: DraftAttachment[], message?: Msg, parentCurrent?: () => boolean) {
  if (isTaskStopping(c.id)) { toast('停止尚未确认，请等待后重试发送', 'info'); return false; }
  if (hasUnconfirmedSend(c.id)) { toast('上一条发送结果未确认，请重新打开任务核对记录后再发送', 'info'); return false; }
  const current = c.personal ? authAccount() : () => true;
  const checkAccount = () => { if (!current()) throw new Error('账号已切换，未继续发送'); };
  if (!current()) return false;
  let memory: Awaited<ReturnType<typeof preparePersonalMemory>>;
  let hasOtherSends: () => boolean = () => false;
  const receipt = sendReceipt(message);
  const selected = usableModel(c, modelFor(c));
  if (c.personal && (!selected || selected.byok || selected.unavailable)) { toast('个人助理只能使用可用的Lom账号模型', 'info'); return false; }
  const wasRunning = !!S.running[c.id];
  update(s => { s.running[c.id] = true; if (!wasRunning) c.turnId = undefined; c.updated = Date.now(); if (message) message.status = 'running'; });
  try {
    const request = (async () => {
      // 外部 Agent（Codex CLI 等）用它自己的模型和登录，不切换 Lom 的模型
      if (!c.agentId) {
        await ensureLomSelection(c.modelId || S.model); checkAccount();
        // D36：服务器下线或改了原模型时，Lom 任务自动改用仍可用的 Lom 模型，不让用户撞报错
        const original = modelFor(c), selected = usableModel(c, original);
        if (wasRunning && selected?.id !== c.modelId) throw new Error('本轮仍在运行，模型配置已更新，请等本轮结束后再发送');
        if (!selected || selected.unavailable) throw new Error('所选模型不可用或旧档位不明确，请重新选择模型');
        if (selected !== original) toast(`原模型已不可用，已改用 ${selected.name}`, 'cube');
        await ensureTaskModel(c, selected); checkAccount();
      }
      if (c.personal) await ensurePersonalBridge(c);
      else if (!c.sideOf && (!c.agentId || c.phoneScope)) await ensureCommander(c);
      await ensureTaskPermissions(c); checkAccount();
      if (parentCurrent && !parentCurrent()) throw new Error('总指挥已停止，未向成员发送任务');
      memory = await preparePersonalMemory(c); checkAccount();
      const ownHistory = ownHistoryPending(c, message);
      const history = ownHistory || atts.some(a => a.historyId) ? HISTORY_PREAMBLE : '';
      const team = S.teams.find(t => t.leaderConv === c.id);
      const roster = team ? rosterContext(team) : '';
      const side = sideChatContext(c);
      if (parentCurrent && !parentCurrent()) throw new Error('总指挥已停止，未向成员发送任务');
      receipt.dispatched();
      const sent = await api<{ turn_id?: string }>('POST', `/api/conversations/${c.id}/messages`, { content: `${publicationPolicy(c)}\n\n${roster}${goalContext(`conv:${c.id}`)}${side?.text ?? ''}${history}${personalIdentityContext(c)}${memory?.text ?? ''}${isChannel(message?.source) ? channelEnvelope(message.source) : ''}${text}`, files: filesOf([...atts, ...(ownHistory ? ownHistoryFiles(c) : [])]) });
      checkAccount();
      side?.commit();
      if (team) rosterDelivered(team, roster);
      return sent;
    })();
    hasOtherSends = trackPendingSend(c.id, request, receipt.classify, message?.id);
    const res = await request; checkAccount();
    if (!res?.turn_id && !receipt.accepted()) throw new Error('核心未返回本轮编号，发送结果未确认');
    memory?.commit();
    markSent(c, message, hasOtherSends, res?.turn_id);
    return true;
  } catch (e) {
    if (!current()) {
      // 账号已切换：不弹提示、不写系统消息；但这条会话自己的「运行中」要收掉，否则切回原账号时一直转圈。
      // 已发出去的请求结果未知，标成未确认，不能当失败让人重发。
      update(s => {
        if (!wasRunning && !hasOtherSends()) delete s.running[c.id];
        if (message?.status === 'running') message.status = receipt.safeFailure(e) ? 'error' : 'unconfirmed';
      });
      return false;
    }
    if (receipt.accepted(e)) {
      memory?.commit();
      markSent(c, message, hasOtherSends);
      console.warn('chat.send_receipt_lost: 消息已被核心接收，未自动重发');
      return true;
    }
    const uncertain = !receipt.safeFailure(e);
    update(s => {
      if (uncertain) s.running[c.id] = true;
      else if (!wasRunning && !isTaskStopping(c.id) && !hasOtherSends()) delete s.running[c.id];
      if (message) message.status = uncertain ? 'unconfirmed' : 'error';
      c.messages.push({ id: uid('m'), type: 'system', at: Date.now(), text: `${uncertain ? '发送结果未确认，请重新打开任务核对记录，未自动重发' : '发送失败'}：${e instanceof Error ? e.message : String(e)}`, ic: 'info' });
    });
    return false;
  }
}

/** 新建任务的可选项。agent：不传 = 用左上角选的；null = Lom；team：属于哪个 OPC 团队（不出现在「最近任务」里） */
export interface TaskOptions { title?: string; phones?: string[]; folder?: string; rules?: string; team?: string; parent?: string; agent?: AgentRow | null; onSendFailure?: (c: Conv) => void; parentCurrent?: () => boolean }

async function retainCreatedTask(created: CoreConversation, options: TaskOptions) {
  if (!options.parentCurrent || options.parentCurrent()) return true;
  // Creation did not start a turn. Remove the unused task and let cleanup failure reach the stop result.
  await api('DELETE', `/api/conversations/${created.id}`);
  return false;
}

/** 首页发送：在 lom-core 里新建一个会话并发送第一条消息。返回新任务 id；失败返回 null 且保留草稿 */
export async function startDesktopTask(text: string, atts: DraftAttachment[], options: TaskOptions = {}): Promise<string | null> {
  const external = options.agent === undefined ? (S.agentPick ? agentRow(S.agentPick) : undefined) : options.agent;
  if (external) return startAgentTask(external, text, atts, options);
  try { await ensureLomSelection(S.model); } catch (e) { toastError('模型同步失败，未创建任务', e); return null; }
  const m = currentPcModel();
  if (!m?.providerId || !m.model) {
    toast('先添加一个模型服务，总指挥才能开始工作', 'key');
    openModal('addKey');
    return null;
  }
  const folder = options.folder || S.folder || getEndpoint()?.defaultFolder || '';
  const title = options.title || text.replace(/\s+/g, ' ').slice(0, 18) || '新的任务';
  let created: CoreConversation;
  const signedIn = S.cloud === 'signed-in';
  const commander = [signedIn ? COMMANDER_RULES : '', options.rules || ''].filter(Boolean).join('\n\n');
  try {
    created = await api<CoreConversation>('POST', '/api/conversations', {
      type: 'aionrs', name: title, model: { provider_id: m.providerId, model: m.model },
      extra: { ...await conversationSkills(), ...(m.lomTier ? { lom_tier: m.lomTier } : {}), ...(signedIn ? await commanderExtra() : {}), ...(folder ? { workspace: folder } : {}), session_mode: effectiveMode(S.permission),
        preset_rules: taskRules(signedIn, commander), exclude_auto_inject_skills: EXCLUDED_AUTO_SKILLS, ...(options.team ? { lom_team: options.team } : {}), ...(options.parent ? { lom_parent: options.parent } : {}),
        ...(S.effortPick && lomSupportsEffort(m.providerId) ? { reasoning_effort: S.effortPick } : {}) },
    });
  } catch (e) {
    toastError('创建任务失败', e);
    return null;
  }
  if (!await retainCreatedTask(created, options)) return null;
  const c: Conv = { ...convFromCore(created), title, loaded: true, providerId: m.providerId, messages: [userMsg(text, atts.map(a => ({ name: a.name, ic: a.ic as Attachment['ic'], preview: a.preview, path: a.path, kind: a.kind, historyId: a.historyId, historyPaths: a.historyPaths })))] };
  update(s => {
    s.convs.unshift(c);
    s.convPhones[c.id] = options.phones || attached('home');
    // 新任务页设的 /goal 归到这个任务（团队、派出去的子任务不接）
    if (s.goals.home && !options.team && !options.parent) { s.goals[`conv:${c.id}`] = s.goals.home; delete s.goals.home; }
  });
  if (options.parent) { if (!await send(c, text, atts, c.messages[0], options.parentCurrent)) return null; }
  else void send(c, text, atts, c.messages[0]).then(ok => { if (!ok) options.onSendFailure?.(c); });
  return c.id;
}

/** 用外部 Agent 新建任务：会话类型为 ACP，由核心启动这个 CLI；勾选手机的新会话使用独立手机工具授权 */
async function startAgentTask(a: AgentRow, text: string, atts: DraftAttachment[], options: TaskOptions = {}): Promise<string | null> {
  if (!usable(a)) { toast(`${a.name} 现在不可用，请到「设置 → Agents」测试连接`, 'info'); return null; }
  const folder = options.folder || S.folder || getEndpoint()?.defaultFolder || '';
  const title = options.title || text.replace(/\s+/g, ' ').slice(0, 18) || '新的任务';
  const phones = [...(options.phones || attached('home'))].filter(id => S.agents[id]?.real);
  let created: CoreConversation;
  let extra: Record<string, unknown> = {};
  try {
    const phoneExtra = S.cloud === 'signed-in' && phones.length ? await commanderExtra() : {};
    extra = { ...agentTaskExtra(a, folder), ...phoneExtra, ...(options.team ? { lom_team: options.team } : {}), ...(options.parent ? { lom_parent: options.parent } : {}) };
    created = await takePreparedTask(extra, title) ?? await api<CoreConversation>('POST', '/api/conversations', {
      type: 'acp', name: title, extra,
    });
  } catch (e) {
    toastError(`用 ${a.name} 创建任务失败`, e);
    return null;
  }
  if (!await retainCreatedTask(created, options)) return null;
  // 新任务页的预选必须在创建时就交给核心；核心没回显时只能报未确认，不能当成功。
  const requested = typeof extra.thought_level === 'string' ? extra.thought_level : '';
  const selected = S.agentEffortPick[a.id];
  if (selected && !requested) {
    update(s => { delete s.agentEffortPick[a.id]; });
    toast(`所选推理强度不在 ${a.name} 当前支持的档位里，已使用默认值`, 'info');
  } else if (requested && created.extra?.thought_level !== requested) {
    toastError('任务已创建，但核心未回显所选推理强度，无法确认是否生效', 'extra.thought_level 未回显');
  }
  const c: Conv = { ...convFromCore(created), title, loaded: true, messages: [userMsg(text, atts.map(x => ({ name: x.name, ic: x.ic as Attachment['ic'], preview: x.preview, path: x.path, kind: x.kind, historyId: x.historyId, historyPaths: x.historyPaths })))] };
  update(s => {
    s.convs.unshift(c);
    s.convPhones[c.id] = phones;
    if (s.goals.home && !options.team && !options.parent) { s.goals[`conv:${c.id}`] = s.goals.home; delete s.goals.home; }
  });
  if (options.parent) { if (!await send(c, text, atts, c.messages[0], options.parentCurrent)) return null; }
  else void send(c, text, atts, c.messages[0]).then(ok => { if (!ok) options.onSendFailure?.(c); });
  void loadConvOptions(c);
  return c.id;
}

/** 目标自动推进的下一轮：不在对话里显示用户消息（正文是隐藏块，历史里也去掉） */
export const GOAL_CONTINUE = '[LOM_GOAL_CONTINUE]\n继续推进目标：先用一句话说下一步做什么，然后直接去做；做完这一步再看离目标还差什么。\n[/LOM_GOAL_CONTINUE]';
export const continueGoal = (c: Conv) => send(c, GOAL_CONTINUE, []).then(ok => { if (!ok) pauseGoal(`conv:${c.id}`, '自动推进没发出去，已暂停'); return ok; });

/** 已有任务里继续发送 */
export function sendToTask(c: Conv, text: string, atts: DraftAttachment[], parentCurrent?: () => boolean) {
  if (hasUnconfirmedSend(c.id)) { toast('上一条发送结果未确认，请重新打开任务核对记录后再发送', 'info'); return Promise.resolve(false); }
  if (isTaskStopping(c.id)) { toast('停止尚未确认，请等待后重试发送', 'info'); return Promise.resolve(false); }
  const message = userMsg(text, atts.map(a => ({ name: a.name, ic: a.ic as Attachment['ic'], preview: a.preview, path: a.path, kind: a.kind, historyId: a.historyId, historyPaths: a.historyPaths })));
  update(() => { c.messages.push(message); });
  return send(c, text, atts, message, parentCurrent);
}

/** FEISHU-02 / PA04：飞书、微信发来的消息或个人助理派的活送进会话；发送成功返回这条用户消息（用来跟踪回复），否则返回 null */
export async function sendFromChannel(c: Conv, text: string, source: ChannelSource, parentCurrent?: () => boolean) {
  if (hasUnconfirmedSend(c.id) || isTaskStopping(c.id) || (parentCurrent && !parentCurrent())) return null;
  const message: Msg = { ...userMsg(text, []), source };
  update(() => { c.messages.push(message); });
  return await send(c, text, [], message, parentCurrent) ? message : null;
}

/** Retry the selected failed snapshot without duplicating its user bubble or changing a fresh draft. */
export function retryTaskMessage(c: Conv, message: Msg) {
  if (message.type !== 'user' || message.status !== 'error' || !c.messages.includes(message)) throw new Error('这条消息不是可重试的发送失败记录');
  if (S.running[c.id] || modelChanges.has(c.id)) throw new Error('请等待当前任务结束后再重试');
  const attachments = message.attachments || [];
  if (attachments.some(a => !a.path)) throw new Error('原附件无法直接重新发送，请重新添加附件');
  return send(c, message.text || '', attachments, message);
}

/** 历史记录把还没确认的写文件也记成了完成：撤回它在「修改了文件」卡片里的那一项 */
function withdrawFileChange(c: Conv, tool: Msg) {
  const path = relPath(String(tool.args?.file_path ?? ''), c.workspace);
  const after = c.messages.slice(c.messages.indexOf(tool) + 1);
  const card = after.find(m => m.type === 'files' && m.changes?.some(ch => ch.path === path));
  if (!card?.changes) return;
  card.changes = card.changes.filter(ch => ch.path !== path);
  if (!card.changes.length) c.messages = c.messages.filter(m => m !== card);
}

/** Apply an already-fetched recovery snapshot inside the caller's guarded state update. */
export function restoreConfirmations(c: Conv, confs: CoreConfirmation[]) {
  for (const m of c.messages) {
    if ((m.type === 'approval' || m.type === 'question') && !confs.some(d => d.id === m.confirmId)) confirmationRemoved(c, m.confirmId);
  }
  for (const d of confs) {
    const callId = normCallId(d.call_id);
    const tool = c.messages.find(m => m.type === 'tool' && m.callId === callId);
    if (tool) { tool.status = 'running'; withdrawFileChange(c, tool); }
    onPermission(c, d);
  }
}

/** Restore runtime and its pending interactive requests after opening a task. */
export async function restoreRuntime(c: Conv) {
  const info = await api<{ runtime?: { is_processing?: boolean; turn_id?: string | null } }>('GET', `/api/conversations/${c.id}`);
  const confs = await api<CoreConfirmation[]>('GET', `/api/conversations/${c.id}/confirmations`);
  if (!S.convs.includes(c)) return;
  update(s => {
    s.running[c.id] = !!info.runtime?.is_processing;
    c.turnId = info.runtime?.turn_id || undefined;
    restoreConfirmations(c, confs);
  });
}

export async function openTask(id: string, options: { refreshWorkspace?: boolean; throwOnError?: boolean } = {}) {
  const c = conv(id);
  if (!c?.remote) { if (options.refreshWorkspace !== false) void refreshWorkspace(); return; }
  try {
    // 外部 Agent（Codex CLI 等）用它自己 CLI 里的模型，核心不记录模型，不能当成错误
    if (!c.agentId) recordTaskModel(c, await api<CoreConversation>('GET', `/api/conversations/${id}`));
    if (c.loaded) {
      await import('./recovery').then(recovery => options.throwOnError ? recovery.recoverTaskHistory(c, true) : recovery.recoverTaskHistory(c));
      if (options.refreshWorkspace !== false) void refreshWorkspace();
      return;
    }
    const { messages, previewFile } = await loadHistory(c);
    update(() => {
      c.messages = messages;
      c.loaded = true;
      if (previewFile) { c.previewFile = previewFile; c.preview = 'ready'; }
    });
    await restoreRuntime(c);
  } catch (e) {
    if (options.throwOnError) throw e;
    toastError('加载任务记录失败', e);
  }
  if (options.refreshWorkspace !== false) void refreshWorkspace();
}

export async function approveTask(c: Conv, m: Msg, ok: '0' | '1' | 'always') {
  return approvePermission(c, m, ok === '0' ? 'deny' : ok === 'always' ? 'always' : 'once');
}

export async function renameTask(c: Conv, name: string) {
  try {
    await api('PATCH', `/api/conversations/${c.id}`, { name, name_source: 'user' });
    update(() => { c.title = name; });
  } catch (e) { toastError('重命名失败', e); }
}

export async function deleteTask(c: Conv) {
  try {
    await api('DELETE', `/api/conversations/${c.id}`);
  } catch (e) { toastError('删除失败', e); return false; }
  return true;
}

/** 输入框左下角切换权限：已打开的任务同步到 lom-core 的会话模式 */
export async function applyModeToTask(id: string) {
  const c = conv(id);
  if (!c?.remote) return true;
  try {
    const t = coreTeamOf(c.id);
    if (t?.core) await applyTeamMode(t.core); // 团队成员一起切换
    else if (c.agentId) await api('PUT', `/api/conversations/${c.id}/config-options/mode`, { value: perm(S.permission).coreMode });
    else await ensureTaskPermissions(c);
    return true;
  } catch (e) { toastError('切换权限失败', e); return false; }
}

export async function applyModelToTask(id: string, selectedId: string) {
  const c = conv(id);
  const m = modelChoice(selectedId);
  if (!c?.remote || !m?.providerId || m.unavailable) return false;
  // D36：运行中不打断这一轮，记下来，这一轮结束后自动切换
  if (S.running[id]) { deferSwitch(id, { model: selectedId }, m.name); return false; }
  if (modelChanges.has(id)) { toast('正在切换模型，请稍候', 'info'); return false; }
  modelChanges.add(id);
  try {
    await ensureTaskModel(c, m);
    const t = coreTeamOf(c.id);
    if (t?.core) await restartCoreSession(t.core); // 团队成员：重启团队会话，按新模型重新接上
    return true;
  }
  catch (e) { toastError('切换模型失败，仍保留原模型', e); return false; }
  finally { modelChanges.delete(id); }
}

/** 导出为 Markdown（保存到下载目录由浏览器 / 外壳负责） */
export function exportMarkdown(c: Conv) {
  const lines = [`# ${c.title}`, ''];
  for (const m of c.messages) {
    if (m.type === 'user') lines.push(`**我**：${m.text ?? ''}`, '');
    else if (m.type === 'assistant') lines.push(`**总指挥**：${m.text ?? ''}`, '');
    else if (m.type === 'tool') lines.push(`> ${m.tool} · ${m.detail ?? ''}`, '');
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${c.title}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* D36：运行中选的模型 / 推理强度，在这一轮结束后执行 */
setSwitchApplier(async (id, change) => {
  if (change.model && await applyModelToTask(id, change.model)) toast(`模型：${modelChoice(change.model)?.name ?? change.model}`, 'cube');
  const c = conv(id);
  if (change.effort === undefined || !c) return;
  try { const result = effortResult(await setTaskEffort(c, change.effort), change.effort); toast(result.text, result.kind); }
  catch (e) { toastError('调整推理强度失败', e); }
});
