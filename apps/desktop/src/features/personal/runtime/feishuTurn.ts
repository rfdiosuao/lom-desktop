import type { FeishuScope } from './feishu';
import { invoke } from '@tauri-apps/api/core';
import { S, watchStore } from '@/state/store';
import type { Conv, Msg } from '@/state/types';

/* ===== FEISHU-02：把一轮回复送回飞书 =====
 * 回复文本 = 这条飞书消息之后、下一条用户消息之前的助理正文；本轮没有正文只有报错时，把报错发回去。 */

export const feishuApi = (scope: FeishuScope, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body: unknown) =>
  invoke<unknown>('feishu_api', { ...scope, method, path, body });

/** lark-cli 输出可能是接口原文，也可能再包一层；按字段名找第一个字符串值 */
export function findField(value: unknown, key: string, depth = 0): string | undefined {
  if (!value || typeof value !== 'object' || depth > 4) return;
  const record = value as Record<string, unknown>;
  if (typeof record[key] === 'string' && record[key]) return record[key] as string;
  for (const v of Object.values(record)) { const found = findField(v, key, depth + 1); if (found) return found; }
}

export interface TurnReply { text: string; failed: boolean; tools: number }

export function replyOf(c: Conv, message: Msg): TurnReply {
  const start = c.messages.indexOf(message);
  const after = start < 0 ? [] : c.messages.slice(start + 1);
  const end = after.findIndex(m => m.type === 'user');
  const turn = end < 0 ? after : after.slice(0, end);
  const text = turn.filter(m => m.type === 'assistant' && m.text?.trim()).map(m => m.text!.trim()).join('\n\n');
  const errors = turn.filter(m => m.type === 'system' && m.ic === 'info' && m.text?.trim()).map(m => m.text!.trim());
  return { text: text || errors.join('\n'), failed: !text && errors.length > 0, tools: turn.filter(m => m.type === 'tool').length };
}

/** 跟踪这一轮直到会话不再运行；过程中每次状态变化都回调最新回复（流式卡片用） */
export function followTurn(c: Conv, message: Msg, onUpdate?: (reply: TurnReply) => void, current = () => true): Promise<TurnReply> {
  return new Promise(resolve => {
    let last = '';
    const check = () => {
      if (!current()) { stop(); resolve({ text: '', failed: true, tools: 0 }); return; }
      const reply = replyOf(c, message);
      const key = `${reply.text}\u0000${reply.tools}`;
      if (key !== last) { last = key; onUpdate?.(reply); }
      if (!S.running[c.id] || !S.convs.includes(c)) { stop(); resolve(reply); }
    };
    const stop = watchStore(check);
    check();
  });
}

export const emptyReply = (reply: TurnReply) => (reply.failed ? '这次没有完成，请稍后再试。' : '已处理完成。');

export async function replyText(scope: FeishuScope, messageId: string, text: string) {
  await feishuApi(scope, 'POST', `/open-apis/im/v1/messages/${messageId}/reply`, { msg_type: 'text', content: JSON.stringify({ text }) });
}

/* FEISHU-05：收到消息立刻给它加一个“正在输入”表情，表示助理在线、已收到；这条处理完（成功或失败）再撤掉。
 * 表情加不上（缺权限、消息已撤回）不影响回复。 */
export async function addTyping(scope: FeishuScope, messageId: string) {
  try {
    const res = await feishuApi(scope, 'POST', `/open-apis/im/v1/messages/${messageId}/reactions`, { reaction_type: { emoji_type: 'Typing' } });
    return findField(res, 'reaction_id');
  } catch (e) { console.warn('feishu.typing_add_failed', e); }
}

export async function removeTyping(scope: FeishuScope, messageId: string, reaction: Promise<string | undefined>) {
  const id = await reaction;
  if (!id) return;
  await feishuApi(scope, 'DELETE', `/open-apis/im/v1/messages/${messageId}/reactions/${id}`, null)
    .catch(e => console.warn('feishu.typing_remove_failed', e));
}
