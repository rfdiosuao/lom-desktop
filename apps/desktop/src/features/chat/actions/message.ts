import { sendPhone } from '@/features/phones/runtime/phoneChat';
import { turtleAnswerPrompt } from '../runtime/turtlePrompt';
import { resendToConversation } from '../runtime/conversationSend';
import { retryTaskMessage } from '../runtime/tasks';
import { modelChanges } from '../runtime/taskModel';
import { conv, normalizeConvId } from '@/state/selectors';
import { unavailable } from '@/shared/lib/unavailable';
import { S, update } from '@/state/store';
import type { Msg } from '@/state/types';
import { uid } from '@/shared/lib/util';
import { sim } from '@/demo/simulator';

export async function retryFailedMessage(ctxId: string, original: Msg) {
  const c = conv(normalizeConvId(ctxId));
  if (!c?.remote) throw new Error('会话已失效，请重新打开后重试');
  return retryTaskMessage(c, original);
}

/** Read authoritative records before the user considers sending an uncertain message again. */
export async function checkUnconfirmedMessage(ctxId: string) {
  const c = conv(normalizeConvId(ctxId));
  if (!c?.remote) throw new Error('会话已失效，请重新打开后核对');
  const { recoverTaskHistory } = await import('../runtime/recovery');
  await recoverTaskHistory(c);
}

/** 重新发送编辑后的内容，保留原始消息与实际执行记录。 */
export async function resendEditedMessage(ctxId: string, original: Msg, text: string): Promise<boolean> {
  const id = normalizeConvId(ctxId);
  if (S.running[id] || modelChanges.has(id)) throw new Error('请等待当前任务结束后再发送修改');
  if (!text.trim() || original.type !== 'user') throw new Error('消息不能为空');
  const c = conv(id);
  if (c?.phoneSession) { await sendPhone(c, text); return true; }
  if (c?.remote) return resendToConversation(c, S.turtles[`conv:${id}`]?.active ? turtleAnswerPrompt(text) : text);
  const message: Msg = { id: uid('m'), type: 'user', at: Date.now(), text };
  if (c) {
    update(() => { c.messages.push(message); }); sim.phone(c, text); return true;
  }
  unavailable('团队协作执行');
  return false;
}
