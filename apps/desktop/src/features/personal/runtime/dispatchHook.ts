import { authAccount, onAuthChange } from '@/features/account/runtime/authScope';
import { isTaskStopping } from '@/features/chat/runtime/cancel';
import { S } from '@/state/store';
import type { Conv, Msg } from '@/state/types';

/* ===== TEAM-ORCH-05（#370）派发完成钩子 =====
 * 个人助理把任务派给普通会话或团队成员后，对方这一轮在平台侧结束（核心给用户消息记下的 turnOutcome）时，
 * 往助理的对话里投一句话唤醒它；助理自己用 session_read 核实真实结果。钩子不夹带成果，也不替它下“成功”的结论。
 * 登记只在内存，24 小时过期：应用重启后不补发（记录里没有可信的断点可恢复），助理仍可用 session_wait / session_read 主动核对。 */

type Hook = { account: string; parent: string; assistant: string; child: string; armedAt: number; attempts: number };
const MAX_HOOKS = 100;
const HOOK_TTL_MS = 24 * 60 * 60_000;
const MAX_ATTEMPTS = 3;
let hooks: Hook[] = [];
let delivering = false;
onAuthChange(() => { hooks = []; });

/** 深夜静默（本机时间），默认关闭：这是唤醒本机助理，不是给人推送，夜里跑的任务不该拖到早上才继续。
 *  想静默就把本机偏好 lom.dispatch-hook.quiet 配成 "HH-HH"（例如 "23-8"）；"off"、留空或写错都按不静默。 */
export function quietWindow(): [number, number] | null {
  let raw = '';
  try { raw = localStorage.getItem('lom.dispatch-hook.quiet') || ''; } catch { /* 取不到偏好就按默认：不静默 */ }
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(raw.trim());
  return m && +m[1] <= 24 && +m[2] <= 24 && m[1] !== m[2] ? [+m[1], +m[2]] : null;
}
export function inQuietHours(now = new Date()) {
  const w = quietWindow();
  if (!w) return false;
  const h = now.getHours();
  return w[0] < w[1] ? h >= w[0] && h < w[1] : h >= w[0] || h < w[1];
}

/** 同一个助理对同一个会话只留一条在等的登记：重复派发是“同一件事”，不会叠出多次通知。
 *  登记 24 小时后过期；超过上限时丢最旧的并留下带错误码的日志，不能让新派发悄悄没有提醒。 */
export function registerDispatchHook(parent: Conv, child: Conv, armedAt = Date.now()) {
  const account = S.account?.id;
  if (!account || !parent.personal?.id || parent === child || child.personal || !S.convs.includes(parent) || !S.convs.includes(child)) return;
  const rest = hooks.filter(h => !(h.parent === parent.id && h.child === child.id));
  while (rest.length >= MAX_HOOKS) {
    const dropped = rest.shift();
    console.warn('personal.dispatch_hook_evicted', { child: dropped?.child });
  }
  hooks = [...rest, { account, parent: parent.id, assistant: parent.personal.id, child: child.id, armedAt, attempts: 0 }];
}

/** 派发之后这条会话上记录的第一条用户消息；它的 turnOutcome 就是平台观测到的这一轮终态。 */
const dispatched = (child: Conv, armedAt: number): Msg | undefined => child.messages.find(m => m.type === 'user' && m.at >= armedAt);

export function dispatchNotice(title: string, outcome: 'completed' | 'failed') {
  const name = title.trim().slice(0, 80) || '未命名会话';
  return outcome === 'completed'
    ? `来自「${name}」的任务已完成`
    : `来自「${name}」的任务已结束，但平台记录这一轮失败`;
}

export async function tickDispatchHooks(now = new Date()) {
  if (delivering || S.conn !== 'ready' || !hooks.length || inQuietHours(now)) return;
  const authenticated = authAccount();
  delivering = true;
  try {
    for (const h of [...hooks]) {
      if (!authenticated()) break;
      if (h.account !== S.account?.id) { hooks = hooks.filter(x => x !== h); continue; }
      if (now.getTime() - h.armedAt > HOOK_TTL_MS) { console.warn('personal.dispatch_hook_expired', { child: h.child }); hooks = hooks.filter(x => x !== h); continue; }
      const parent = S.convs.find(c => c.id === h.parent && c.personal?.id === h.assistant);
      const child = S.convs.find(c => c.id === h.child);
      if (!child || !parent) { if (!child) hooks = hooks.filter(x => x !== h); continue; }
      const outcome = dispatched(child, h.armedAt)?.turnOutcome;
      if (!outcome || S.running[child.id] || isTaskStopping(child.id)) continue;
      if (outcome === 'cancelled') { hooks = hooks.filter(x => x !== h); continue; } // 用户自己停的，不需要叫醒助理
      if (S.running[parent.id] || isTaskStopping(parent.id)) continue; // 助理这一轮没结束，下一拍再投
      const live = () => authenticated() && S.convs.includes(parent) && S.convs.includes(child) && hooks.includes(h);
      const { sendFromChannel } = await import('@/features/chat/runtime/tasks');
      if (!live() || S.running[parent.id]) continue;
      // 目标没接受（返回假）或发送抛错都属于没送到：保留钩子下一拍重试，最多 3 次，仍失败就带错误码放弃。
      h.attempts += 1;
      let sent = false;
      try { sent = !!await sendFromChannel(parent, dispatchNotice(child.title, outcome), 'dispatch_done', () => authenticated() && S.convs.includes(parent), undefined, { dispatchOf: child.id }); }
      catch { sent = false; }
      if (sent) hooks = hooks.filter(x => x !== h);
      else if (h.attempts >= MAX_ATTEMPTS) { console.warn('personal.dispatch_hook_send_failed', { child: h.child, attempts: h.attempts }); hooks = hooks.filter(x => x !== h); }
    }
  } finally { delivering = false; }
}
