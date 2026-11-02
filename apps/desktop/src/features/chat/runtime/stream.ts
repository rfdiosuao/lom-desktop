import { evolvePersonalTurn } from '@/features/personal/runtime/evolution';
import { syncScheduledMessages } from './scheduledMessage';
import { applyAcpTool, toolImages } from './toolImages';
import { audit } from '@/features/settings/runtime/audit';
import { syncSchedules } from '@/features/schedules/runtime/schedules';
import { taskFinished } from '@/app/sound';
import { S, update, updateSoon } from '@/state/store';
import type { Conv, Msg } from '@/state/types';
import { uid } from '@/shared/lib/util';
import { refreshTaskList } from './taskSync';
import { LOM_PROVIDER_NAME, refreshPoints } from '@/features/account/runtime/cloud';
import { attachmentOfPath, errorText, fileChangeOf, friendlyModelError, isHtml, mergeFileChange, normCallId, splitFilesMarker, toolMsg } from './tools';
import type { CoreEvent, StreamData } from '@/core/types';
import { confirmationRemoved, onPermission } from './permissions';
import { onAsk } from './questions';
export { answerConfirmation, onPermission } from './permissions';
import { refreshWorkspace } from '@/features/workspace/runtime/workspace';
import { checkGoalReached, compactNotice, goalWantsNextTurn } from './commands';
import { teammateMsg } from '@/features/teams/runtime/coreTeam';
import { emitActivityEvent } from '@/features/teams/activity/activityEvents';
import { quietError } from '@/shared/overlays/controller';
import { hasInFlightSend, hasUnconfirmedSend, recordCompletedTurn } from './cancel';
import { channelOf } from './channelSource';

/* ===== lom-core 推送 → 界面状态 =====
 * message.stream 的 type：start / content / thought / tool_call / acp_permission / finish / error；
 * turn.completed 表示整轮结束。未知类型只记录在控制台，不影响界面。 */

const convOf = (id: unknown): Conv | undefined => S.convs.find(c => c.remote && c.id === id);

/** 本轮最后一条消息是同一段流式回复时接着写，否则开一段新的 */
function appendText(conv: Conv, msgId: string, chunk: string, type: 'assistant' | 'thinking') {
  const last = conv.messages[conv.messages.length - 1];
  if (last && last.type === type && last.remoteId === msgId && last.streaming) {
    last.text = (last.text || '') + chunk;
    return;
  }
  conv.messages.push({ id: uid('m'), type, at: Date.now(), text: chunk, agent: 'pc', streaming: true, remoteId: msgId });
}

/** 工具调用的终态；其他状态（如 running / pending）都当作「开始执行」 */
const FINAL_STATUS = new Set(['completed', 'success', 'error', 'failed', 'cancelled', 'canceled']);

const endStreaming = (conv: Conv) => conv.messages.forEach(m => { if (m.streaming) m.streaming = false; });

function onToolCall(conv: Conv, d: Record<string, unknown>) {
  const callId = normCallId(d.call_id);
  const name = String(d.name ?? '');
  const known = conv.messages.find(m => m.type === 'tool' && m.callId === callId);
  const status = String(d.status ?? '');
  audit(conv.id, callId, name || known?.toolName || 'tool', status || 'running');
  if (!FINAL_STATUS.has(status)) {
    if (known) return;
    const args = (d.args as Record<string, unknown>) || {};
    const m = toolMsg(callId, name, args, conv.workspace);
    endStreaming(conv);
    conv.messages.push(m);
    if (isHtml(String(args.file_path ?? ''))) {
      conv.preview = 'building';
      if (!S.layout.rightCollapsed && S.wsTab !== 'phone') S.wsTab = 'preview';
    }
    return;
  }
  if (!known) return;
  const ok = status === 'completed' || status === 'success';
  known.status = ok ? 'done' : 'error';
  if (ok) known.images = toolImages(d);
  if (typeof d.output === 'string' && !known.output) known.output = d.output;
  const change = ok ? fileChangeOf(known.toolName || name, known.args || {}, conv.workspace) : null;
  if (change) {
    mergeFileChange(conv.messages, change);
    const abs = String(known.args?.file_path ?? '');
    if (isHtml(abs)) { conv.previewFile = abs; conv.preview = 'ready'; }
    void refreshWorkspace();
  } else if (conv.preview === 'building') {
    conv.preview = conv.previewFile ? 'ready' : null;
  }
}

function onStream(sd: StreamData) {
  const conv = convOf(sd.conversation_id);
  if (!conv || sd.hidden) return;
  const d = sd.data || {};
  if (sd.turn_id) conv.turnId = sd.turn_id;
  switch (sd.type) {
    case 'start': S.running[conv.id] = true; break;
    case 'content': appendText(conv, sd.msg_id, String(d.content ?? ''), 'assistant'); break;
    case 'thought': case 'thinking': appendText(conv, `${sd.msg_id}:t`, String(d.content ?? d.text ?? d.subject ?? ''), 'thinking'); break;
    case 'tool_call': onToolCall(conv, d); break;
    case 'acp_tool_call': endStreaming(conv); applyAcpTool(conv.messages, d); break;
    case 'acp_permission': onPermission(conv, d); break;
    case 'ask': endStreaming(conv); onAsk(conv, d.request_id, d.questions); break;
    case 'finish': endStreaming(conv); break;
    case 'error': {
      endStreaming(conv);
      const lom = S.providers.find(p => p.name === LOM_PROVIDER_NAME);
      const usesLom = !!lom && conv.providerId === lom.id;
      conv.messages.push({ id: uid('m'), type: 'system', at: Date.now(), text: friendlyModelError(errorText(d), usesLom), ic: 'info' });
      if (usesLom) void refreshPoints();
      break;
    }
    default: console.debug('lom-core: 未处理的流式事件类型', sd.type);
  }
  conv.updated = Date.now();
}

function onUserCreated(d: Record<string, unknown>) {
  const conv = convOf(d.conversation_id);
  if (!conv) return;
  const { text, paths } = splitFilesMarker(String(d.content ?? ''));
  if (text.trim() === '/compact') return; // 压缩命令本身不当成用户消息显示
  if (!text.trim() && !paths.length) return; // 目标自动推进等隐藏消息
  const mine = [...conv.messages].reverse().find(m => m.type === 'user' && !m.remoteId && m.text === text);
  if (mine) { mine.remoteId = String(d.msg_id); return; }
  if (conv.messages.some(m => m.remoteId === d.msg_id)) return;
  conv.messages.push({
    id: uid('m'), type: 'user', at: Number(d.created_at) || Date.now(), text, remoteId: String(d.msg_id), ...channelOf(String(d.content ?? '')),
    ...(paths.length ? { attachments: paths.map(attachmentOfPath) } : {}),
  });
}

/** 压缩这一轮结束：「正在压缩上下文…」换成结果，引擎的英文回复不再单独显示 */
function settleCompact(conv: Conv) {
  const i = conv.messages.map(m => m.type === 'system' && m.text === '正在压缩上下文…').lastIndexOf(true);
  if (i < 0) return;
  const reply = conv.messages.slice(i + 1).find(m => m.type === 'assistant' && compactNotice(m.text));
  conv.messages[i] = { ...conv.messages[i], text: compactNotice(reply?.text) || '压缩没有完成，可以稍后重试', ic: reply ? 'check' : 'info' };
  if (reply) conv.messages = conv.messages.filter(m => m !== reply);
}

function onTurnCompleted(d: Record<string, unknown>) {
  const conv = convOf(d.conversation_id);
  if (!conv) return;
  if (typeof d.turn_id === 'string' && conv.turnId && d.turn_id !== conv.turnId) return;
  if (typeof d.turn_id === 'string') recordCompletedTurn(conv.id, d.turn_id);
  endStreaming(conv);
  const pendingSend = hasInFlightSend(conv.id) || hasUnconfirmedSend(conv.id);
  if (pendingSend) S.running[conv.id] = true;
  else delete S.running[conv.id];
  if (pendingSend) void import('./recovery').then(r => r.recoverTaskHistory(conv)).catch(e => quietError('stream.recover_failed', e));
  conv.messages.forEach(m => { if (m.type === 'tool' && m.status === 'running') m.status = d.status === 'finished' ? 'done' : 'error'; });
  if (conv.preview === 'building') conv.preview = conv.previewFile ? 'ready' : null;
  if (d.status && d.status !== 'finished' && d.status !== 'cancelled') {
    conv.messages.push({ id: uid('m'), type: 'system', at: Date.now(), text: `这一轮没有正常完成（${String(d.status)}）`, ic: 'info' });
  }
  conv.updated = Date.now();
  settleCompact(conv);
  const lastUser = conv.messages.findLastIndex(m => m.type === 'user');
  const lastReply = conv.messages.slice(lastUser + 1).findLast(m => m.type === 'assistant');
  if (d.status === 'finished') checkGoalReached(`conv:${conv.id}`, lastReply?.text);
  // 目标还没达成、没暂停：稍等一下自动推进下一轮（停止、出错、连续太多轮会自动暂停）
  if (goalWantsNextTurn(`conv:${conv.id}`, d.status)) {
    const id = conv.id;
    setTimeout(() => {
      const c = S.convs.find(x => x.id === id);
      const g = S.goals[`conv:${id}`];
      if (c && g && !g.done && !g.paused && !S.running[id]) void import('./tasks').then(t => t.continueGoal(c));
    }, 800);
  }
  if (d.status === 'finished' && !pendingSend) {
    taskFinished(conv.id);
    if (typeof d.turn_id === 'string') void evolvePersonalTurn(conv, d.turn_id);
  }
  void refreshWorkspace();
  /* 自带 Key 的完成事件不触发 Lom 计费同步。 */
  const p = S.providers.find(p => p.id === conv.providerId);
  if (p?.name === LOM_PROVIDER_NAME) void refreshPoints();
}

function onConfirmationRemoved(d: Record<string, unknown>) {
  const conv = convOf(d.conversation_id);
  if (conv) confirmationRemoved(conv, d.id);
}

export function handleCoreEvent(e: CoreEvent) {
  const d = e.data || {};
  switch (e.name) {
    case 'cron.job-created': case 'cron.job-updated': case 'cron.job-removed': case 'cron.job-executed': void syncSchedules(); break;
    case 'conversation.artifact': {
      const conv = convOf(d.conversation_id);
      if (d.kind === 'cron_trigger' && conv) void syncScheduledMessages(conv).catch(e => quietError('stream.cron_prompt_failed', e));
      break;
    }
    case 'message.stream': updateSoon(() => onStream(d as unknown as StreamData)); break;
    case 'message.userCreated': update(() => onUserCreated(d)); break;
    case 'turn.completed': update(() => onTurnCompleted(d)); break;
    case 'confirmation.remove': update(() => onConfirmationRemoved(d)); break;
    case 'team.teammateMessage': {
      // 内核团队里别的成员发来的消息：显示在收信成员的窗格里
      const conv = convOf(d.conversation_id), m = teammateMsg(String(d.msg_id || uid('m')), Date.now(), d.from_name, d.content);
      if (conv && m && !conv.messages.some(x => x.id === m.id)) update(() => { conv.messages.push(m); conv.updated = Date.now(); });
      break;
    }
    // D33 团队活动看板：按 id 原位更新或插入，看板自己订阅，不等整页刷新
    case 'team.mailboxChanged': case 'team.taskChanged': emitActivityEvent(e.name, d); break;
    case 'conversation.nameUpdated': {
      const conv = convOf(d.conversation_id ?? d.id);
      const name = d.name ?? d.title;
      if (conv && typeof name === 'string' && name) update(() => { conv.title = name; });
      break;
    }
    case 'conversation.listChanged': void refreshTaskList(); break;
    default: break;
  }
}

export type { Msg };
