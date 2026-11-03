import { api } from '@/core/client';
import type { CoreConfirmation } from '@/core/types';
import { completedTurnStatus, isTaskStopping } from '@/features/chat/runtime/cancel';
import { refreshPhoneChat } from '@/features/phones/runtime/phoneChat';
import { S, watchStore } from '@/state/store';
import type { Conv } from '@/state/types';

const terminal = (status?: string) => status === 'finished' || status === 'completed' ? 'completed'
  : ['failed', 'error', 'timeout', 'interrupted'].includes(status || '') ? 'failed'
  : ['cancelled', 'stopped'].includes(status || '') ? 'stopped' : undefined;
const short = (v: unknown, n: number) => String(v || '').slice(0, n);
function approvals(rows: { id: string; title?: string | null; description?: string; type?: string }[]) {
  return { pending_count: rows.length, pending: rows.slice(0, 10).map(r => ({ id: short(r.id, 160), title: short(r.title, 160), description: short(r.description, 300) })), pending_truncated: rows.length > 10 };
}
async function snapshot(c: Conv, turn: string | undefined, signal: AbortSignal) {
  if (c.owner !== 'pc') {
    if (S.agents[c.owner]?.status === 'offline') return { status: 'offline', running: false };
    await refreshPhoneChat(c);
    const pending = c.messages.filter(m => ['approval', 'question'].includes(m.type) && ['pending', 'submitting'].includes(m.status || ''));
    const status = turn ? 'unknown' : pending.length ? (pending.some(m => m.type === 'question') ? 'awaiting_input' : 'awaiting_approval')
      : c.phonePending || isTaskStopping(c.id) ? 'unknown' : S.running[c.id] ? 'running' : terminal(c.phoneRunStatus) || 'unknown';
    return { status, running: !!S.running[c.id], ...approvals(pending.map(m => ({ id: m.id, title: m.title, description: m.desc || m.text }))), note: turn ? '手机协议没有可核对的 turn_id，不能确认指定轮次结果。' : undefined };
  }
  const [info, pending] = await Promise.all([
    api<{ runtime?: { is_processing?: boolean; turn_id?: string | null } }>('GET', `/api/conversations/${c.id}`, undefined, { signal }),
    api<CoreConfirmation[]>('GET', `/api/conversations/${c.id}/confirmations`, undefined, { signal }),
  ]);
  if (!info?.runtime || typeof info.runtime.is_processing !== 'boolean' || !Array.isArray(pending))
    throw new Error('无法确认运行及待审批状态');
  const active = !!info.runtime?.is_processing || !!S.running[c.id];
  const requestedTurn = turn || info.runtime.turn_id || c.turnId;
  const completed = completedTurnStatus(c.id, requestedTurn);
  const latestUser = c.messages.findLast(m => m.type === 'user');
  const uncertain = ['unconfirmed', 'error'].includes(latestUser?.status || '');
  const status = turn && info.runtime?.turn_id && info.runtime.turn_id !== turn && active ? 'unknown'
    : pending.length ? (pending.some(p => Array.isArray(p.questions) && p.questions.length > 0) ? 'awaiting_input' : 'awaiting_approval')
    : active ? 'running' : isTaskStopping(c.id) || uncertain ? 'unknown' : terminal(completed) || 'unknown';
  return { status, running: active, turn_id: requestedTurn, ...approvals(pending) };
}

/** Bound even phone RPCs that do not yet accept AbortSignal; never return stale account data. */
export async function sessionState(c: Conv, current: () => boolean, turn?: string, timeout = 5000) {
  const live = () => current() && S.convs.includes(c);
  if (!live()) throw new Error('助理已停止、账号或目标会话已变化');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unwatch = () => {};
  try {
    const interrupted = new Promise<never>((_, reject) => {
      const fail = (message: string) => { controller.abort(); reject(new Error(message)); };
      timer = setTimeout(() => fail('状态查询超时，结果未知；请读取会话核实'), timeout);
      unwatch = watchStore(() => { if (!live()) fail('助理已停止、账号或目标会话已变化'); });
    });
    const result = await Promise.race([snapshot(c, turn, controller.signal), interrupted]);
    if (!live()) throw new Error('助理已停止、账号或目标会话已变化');
    return { session_id: c.id, ...result, note: ('note' in result && result.note) || 'completed 仅表示本轮结束；用 session_read 核对回复和工具结果是否达成目标。' };
  } finally { clearTimeout(timer); unwatch(); controller.abort(); }
}

export async function waitSession(c: Conv, args: Record<string, unknown>, current: () => boolean) {
  const timeout = args.timeout_ms === undefined ? 25_000 : Number(args.timeout_ms);
  if (!Number.isInteger(timeout) || timeout < 0 || timeout > 30_000) throw new Error('timeout_ms 必须为 0 到 30000 的整数');
  const turn = args.turn_id === undefined ? undefined : String(args.turn_id);
  const deadline = Date.now() + timeout;
  // timeout=0 requests one bounded fresh snapshot, not an impossible 1ms RPC deadline.
  const snapshotBudget = timeout === 0 ? 2000 : undefined;
  while (true) {
    const result = await sessionState(c, current, turn, snapshotBudget ?? Math.max(1, Math.min(5000, deadline - Date.now())));
    if (result.status !== 'running' || Date.now() >= deadline) return { ...result, timed_out: result.status === 'running' };
    await new Promise(resolve => setTimeout(resolve, Math.min(250, Math.max(0, deadline - Date.now()))));
    if (!current()) throw new Error('助理已停止或账号已变化');
  }
}
