import { api } from '@/core/client';
import type { CoreConfirmation, CorePermissionRequest } from '@/core/types';
import { S, update } from '@/state/store';
import type { Conv, Msg } from '@/state/types';
import { uid } from '@/shared/lib/util';
import { toast, toastError } from '@/shared/overlays/controller';
import { permissionChoice, permissionIdentity, permissionRequest, type PermissionAction } from './permissionOptions';
import { personalAutoAllow, personalFullAccess } from '@/features/personal/runtime/permissions';
import { mirrorFeishuConfirmation } from '@/features/personal/runtime/feishuApprovals';
import { nativeFullAccess } from '@/state/selectors';
import { onAsk } from './questions';

const restricted = (c: Conv) => !!c.sideOf || (!c.personal && S.permission === 'readonly') || (!personalFullAccess(c) && !nativeFullAccess(c) && S.prefs.allowInstall === 'deny');

/** A side chat with no deny option cannot be answered safely. Never leave the
 * card pending forever and never pretend a decision was submitted: mark it
 * rejected and stop the turn so the core clears the hung confirmation. */
function stopUnanswerableSideChat(c: Conv, m: Msg) {
  m.confirmationProblem = '核心没有提供拒绝选项，无法提交决定；正在停止侧边聊天。';
  c.messages.push({ id: uid('m'), type: 'system', at: Date.now(), text: '侧边聊天没有可拒绝的权限选项，已停止这一步；不会允许任何操作。', ic: 'shield' });
  update(() => {
    if (m.status === 'pending' || m.status === 'submitting') {
      m.status = 'denied';
      m.confirmationSubmitted = true;
    }
  });
  // cancel.ts already reaches this module through the task runtime; a static
  // import would add another cycle, so resolve it only when actually needed.
  void import('./cancel')
    .then(({ stopTask }) => stopTask(c.id))
    .catch(e => toastError('停止侧边聊天失败', e));
}

function checkBackend(c: Conv, m: Msg) {
  const current = permissionIdentity(c);
  if (current.backendConflict || !m.confirmationEngine || (m.confirmationEngine !== 'unknown' && current.engine !== m.confirmationEngine)) {
    throw new Error('Agent 配置已变化或权限通道无法确认，未提交决定；请停止并新建任务。');
  }
}

/** Never fabricate a permission option or infer authorization from a tool's name. */
export async function answerConfirmation(c: Conv, m: Msg, action: PermissionAction, coreRead = false) {
  if (!m.confirmId || !m.callId) throw new Error('权限请求缺少编号，请重新打开任务。');
  checkBackend(c, m);
  // A side chat never widens permissions, whichever engine asks. Embedded
  // read-only requests still pass because onPermission marks them coreRead.
  if (!coreRead && (c.sideOf || (m.confirmationEngine === 'embedded' && restricted(c)))) action = 'deny';
  if (m.confirmationEngine === 'embedded' && action === 'always' && (c.personal || S.prefs.allowInstall !== 'allow')) action = 'once';
  const option = permissionChoice(m, action);
  if (!option) {
    if (c.sideOf) { stopUnanswerableSideChat(c, m); return 'deny'; }
    throw new Error('核心未提供可用的权限选项，未提交决定；请停止任务后重试。');
  }
  await api('POST', `/api/conversations/${c.id}/confirmations/${encodeURIComponent(m.callId)}/confirm`, {
    msg_id: m.confirmId, data: { value: option.value }, always_allow: action === 'always',
  });
  return action;
}

async function submitDecision(c: Conv, m: Msg, submit: () => Promise<PermissionAction | 'choice'>) {
  if (m.status !== 'pending' || !c.remote || !S.convs.includes(c) || !c.messages.includes(m)) return;
  update(() => { m.status = 'submitting'; });
  try {
    const decided = await submit();
    if (!S.convs.includes(c) || !c.messages.includes(m) || !['submitting', 'resolved'].includes(m.status || '')) return;
    update(() => {
      m.status = decided === 'choice' ? 'resolved' : decided === 'deny' ? 'denied' : 'approved';
      m.confirmationSubmitted = true;
      if (decided === 'deny') c.messages.push({ id: uid('m'), type: 'system', at: Date.now(), text: '已提交拒绝这一步的决定。', ic: 'shield' });
    });
    if (decided === 'always') toast('已提交总是允许的决定', 'shield');
  } catch (e) {
    update(() => { if (m.status === 'submitting') m.status = 'pending'; });
    toastError('提交确认失败', e);
  }
}

export const approvePermission = (c: Conv, m: Msg, action: PermissionAction, coreRead = false) =>
  submitDecision(c, m, () => answerConfirmation(c, m, action, coreRead));

/** ACP recovery preserves option IDs but not their kinds. Let the user choose
 * the actual offered label, and never claim to know its allow/deny meaning. */
export function approvePermissionOption(convId: string, m: Msg, value: string) {
  const c = S.convs.find(c => c.id === convId);
  if (!c) return Promise.resolve();
  return submitDecision(c, m, async () => {
    checkBackend(c, m);
    // The meaning of recovered ACP choices is unknown; a read-only side chat
    // must never submit one that could allow a write.
    if (c.sideOf) throw new Error('侧边聊天只读，未提交放权选项。');
    if (m.confirmationEngine !== 'acp' || !m.confirmId || !m.callId || !m.confirmationOptions?.some(o => o.action === 'choice' && o.value === value)) throw new Error('此权限选项不可用，未提交决定。');
    await api('POST', `/api/conversations/${c.id}/confirmations/${encodeURIComponent(m.callId)}/confirm`, { msg_id: m.confirmId, data: { value }, always_allow: false });
    return 'choice';
  });
}

export function onPermission(c: Conv, raw: CoreConfirmation | CorePermissionRequest | Record<string, unknown>) {
  const d = permissionRequest(c, raw);
  if (!d) {
    c.messages.push({ id: uid('m'), type: 'system', at: Date.now(), text: '权限请求数据不完整，未允许任何操作，请停止任务后重试。', ic: 'shield' });
    return;
  }
  if (d.questions) {
    // The recovery shape is shared with legacy ACP questions, whose core task
    // has no AnswerAsk command. Only the direct Claude backend supports recovery.
    if (!('tool_call' in raw) && d.backend === 'claude' && !d.backendConflict) onAsk(c, d.callId, d.questions, d.id);
    else c.messages.push({ id: uid('m'), type: 'system', at: Date.now(), text: '此 Agent 的权限通道提问暂不支持回答，未允许任何操作，请停止任务后重试。', ic: 'shield' });
    return;
  }
  if (c.messages.some(m => m.type === 'approval' && m.confirmId === d.id)) return;
  const tool = c.messages.find(m => m.type === 'tool' && m.callId === d.callId);
  const command = tool ? `${tool.tool} · ${tool.detail}` : d.description || d.title;
  const m: Msg = { id: uid('m'), type: 'approval', at: Date.now(), command, status: 'pending', confirmId: d.id, callId: d.callId, confirmationOptions: d.options, confirmationEngine: d.engine };
  if (d.backendConflict) m.confirmationProblem = 'Agent 配置已变化，无法确认当前权限通道，请停止并新建任务。';
  c.messages.push(m);
  // Only the embedded core's structured category can authorize a read.
  const read = d.engine === 'embedded' && d.commandType === 'info';
  // Front-end last line of defense for side chats: never prompt the user to
  // widen permission. Core-side read-only policy still has to enforce the
  // tools themselves (lom-core PR #4).
  if (c.sideOf) {
    // A read may pass through once when the core offers it; everything else
    // must be rejected. If neither option exists, stop instead of leaving a
    // disabled reject button and a pending card.
    const action: PermissionAction = read && permissionChoice(m, 'once') ? 'once' : 'deny';
    if (!permissionChoice(m, action)) { stopUnanswerableSideChat(c, m); return; }
    void approvePermission(c, m, action, read);
    return;
  }
  const autoRead = c.personal ? personalAutoAllow(c, d.engine, d.commandType) : read || (d.engine === 'embedded' && nativeFullAccess(c));
  if (autoRead || (d.engine === 'embedded' && restricted(c))) void approvePermission(c, m, autoRead ? 'once' : 'deny', autoRead);
  else void mirrorFeishuConfirmation(c, m).catch(() => console.warn('feishu.approval_mirror_failed'));
}

/** A removal says that the request is gone, never whether another client allowed it. */
export function confirmationRemoved(c: Conv, id: unknown) {
  c.messages.forEach(m => {
    if ((m.type === 'approval' || m.type === 'question') && m.confirmId === id && (m.status === 'pending' || m.status === 'submitting')) m.status = 'resolved';
  });
}
