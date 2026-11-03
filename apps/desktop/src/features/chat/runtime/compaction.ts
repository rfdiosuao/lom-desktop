import { api } from '@/core/client';
import { S, update } from '@/state/store';
import type { Conv, Msg } from '@/state/types';
import { uid } from '@/shared/lib/util';
import { isTaskStopping, pendingSends } from './cancel';
import { sendReceipt } from './sendReceipt';

/* ===== REFACTOR-01 模块 3（#280）：上下文压缩的状态与契约 =====
 * 压缩原来只靠提示文字「正在压缩上下文…」表示进行中，终态时按文字查找；请求失败后提示一直转圈，
 * 之后任意一轮结束又会把它改写成「压缩没有完成」。现在状态记在提示消息的 compaction 字段上，并绑定压缩自己的轮次：
 * 进行中 → 完成 / 已精简 / 已停止 / 没有完成；请求被拒绝为「没有开始」，发出后回执丢失为「未确认」（不自动重试）。
 * 原始历史和未完成的任务一律不动；压缩成功的唯一证据是引擎在这一轮的压缩回复。 */

const RUNNING_TEXT = '正在压缩上下文…';

/** 还没有终态的压缩提示。旧版本只写了文字没有字段，兼容判断只放在这里 */
const isOpen = (m: Msg) => m.type === 'system' && (m.compaction === 'running' || m.compaction === 'unconfirmed' || (m.compaction === undefined && m.text === RUNNING_TEXT));
const isRunning = (m: Msg) => m.type === 'system' && (m.compaction === 'running' || (m.compaction === undefined && m.text === RUNNING_TEXT));

const idle = (c: Conv) => !S.running[c.id] && !pendingSends.has(c.id);

/** 引擎压缩后的回复翻成一句中文（实时和历史都用） */
export function compactNotice(text?: string): string | null {
  if (!text) return null;
  if (/^Context is already compact/i.test(text)) return '上下文已经很精简，不需要压缩';
  const m = /^Context compacted[^\n]*?(\d+)\s+messages?\s+summar/i.exec(text);
  if (m) return `已压缩上下文：前面 ${m[1]} 条消息整理成了摘要，后面的对话更省额度`;
  if (/^Context compacted/i.test(text)) return '已压缩上下文';
  return null;
}

/** Lom 自己的引擎（aionrs）内置 /compact，消息正文必须正好是 /compact，前面不能带设置块。外部 Agent 只有它自己报了 compact 命令才发。 */
export async function compactTask(c: Conv) {
  if (!c.remote) throw new Error('只有电脑上的任务可以压缩');
  if (!idle(c) || isTaskStopping(c.id)) throw new Error('任务还在执行或停止尚未确认，等这一轮结束再压缩');
  if (c.messages.some(isRunning)) throw new Error('上一次压缩还在进行，请等它结束');
  if (c.agentId) {
    // lom-core SlashCommandItem { command, description }（aionui-api-types agent_build_extra.rs）
    const cmds = await api<{ command: string }[]>('GET', `/api/conversations/${c.id}/slash-commands`).catch(() => []);
    if (!cmds.some(x => x.command.replace(/^\//, '') === 'compact')) throw new Error(`${c.agentName || '这个 Agent'} 没有提供压缩上下文的命令`);
  }
  const notice: Msg = { id: uid('m'), type: 'system', at: Date.now(), text: RUNNING_TEXT, ic: 'refresh', compaction: 'running' };
  const receipt = sendReceipt(undefined);
  update(s => { s.running[c.id] = true; c.messages.push(notice); });
  try {
    receipt.dispatched();
    const res = await api<{ turn_id?: string }>('POST', `/api/conversations/${c.id}/messages`, { content: '/compact', files: [] });
    if (res?.turn_id) update(() => { c.turnId = res.turn_id; notice.compactTurn = res.turn_id; });
  } catch (e) {
    // 核心明确拒绝：压缩没有开始；已发出但没有回执：核心可能正在压缩，标为未确认，等这一轮的终态或用户核对，不自动重试
    const unknown = !receipt.safeFailure(e), reason = e instanceof Error ? e.message : String(e);
    update(s => {
      delete s.running[c.id];
      Object.assign(notice, unknown
        ? { compaction: 'unconfirmed', ic: 'info', text: '压缩请求结果未确认，未自动重试。可以稍后重新打开任务核对' }
        : { compaction: 'failed', ic: 'info', text: `压缩没有开始：${reason}` });
    });
    throw e;
  }
}

/** 一轮结束：只结算属于这一轮的压缩提示；引擎的英文压缩回复折叠进提示，不再单独显示 */
export function settleCompaction(conv: Conv, status?: string, turnId?: string) {
  const i = conv.messages.findLastIndex(isOpen);
  if (i < 0) return;
  const notice = conv.messages[i];
  if (notice.compactTurn && turnId && notice.compactTurn !== turnId) return;
  const reply = conv.messages.slice(i + 1).find(m => m.type === 'assistant' && compactNotice(m.text));
  const done = compactNotice(reply?.text);
  conv.messages[i] = done
    ? { ...notice, text: done, ic: 'check', compaction: 'done' }
    : status === 'cancelled'
      ? { ...notice, text: '压缩已停止，原有上下文保持不变', ic: 'info', compaction: 'stopped' }
      : { ...notice, text: '压缩没有完成，可以稍后重试', ic: 'info', compaction: 'failed' };
  if (reply) conv.messages = conv.messages.filter(m => m !== reply);
}
