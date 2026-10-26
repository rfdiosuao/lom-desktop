import { phoneRpc } from './phoneRpc';
import { savePhoneCache } from './phoneCache';
import { syncPhoneModel } from './phoneModel';
import { syncPhoneHistory } from './phoneChat';
import { S, update } from '@/state/store';
import type { Schedule } from '@/state/types';
import type { PhoneSchedule, PhoneSchedules, ScheduleWrite, ScheduleAction } from '@/core/remoteWire';
const pendingCreates = new WeakMap<Schedule, string>();
const PENDING_KEYS = ['pendingRun', 'pendingOp', 'pendingRunAt', 'pendingRunRuns', 'pendingRunTask', 'pendingRunRevision', 'pendingError'] as const;
/** 跨重启自动补发/核对的最长时间；超窗后手机侧回执去重不再可靠，停止自动重放并转为人工确认。 */
const RECONCILE_WINDOW_MS = 10 * 60_000;
const errText = (e: unknown) => e instanceof Error ? e.message : String(e);
const codeOf = (e: unknown) => (e as { code?: string } | null)?.code || errText(e);
/**
 * 手机端明确没有开始执行的 RPC 错误。receipt_failed 可能发生在任务启动之后（第二次回执写入失败），
 * 网络超时、账号切换、回执不匹配等也不能证明未执行，这些一律视为结果未知并保留原请求 ID。
 */
const NOT_EXECUTED = new Set(['schedule.invalid_id', 'schedule.invalid_request', 'schedule.missing',
  'schedule.id_reused', 'schedule.dispatch_failed', 'sync.conflict']);
const definitelyNotExecuted = (e: unknown) => NOT_EXECUTED.has(codeOf(e));
type RunReply = { status?: string };
/** schedule.run 的已知回执只有 accepted / failed / dispatching（重放未完成请求）；
 * failed/rejected 表示手机明确未开始，其余协议外状态按未知处理。 */
function runOutcome(reply: RunReply): 'accepted' | 'failed' | 'unknown' {
  if (reply?.status === 'accepted') return 'accepted';
  if (reply?.status === 'failed' || reply?.status === 'rejected') return 'failed';
  return 'unknown';
}
/** 没有发起时间（旧缓存）或超过对账窗口时，不再自动重放同一请求 ID。 */
const withinReconcileWindow = (x: Schedule) => !!x.pendingRunAt && Date.now() - x.pendingRunAt <= RECONCILE_WINDOW_MS;
function clearPending(id: string) {
  update(s => { const row = s.schedules.find(y => y.id === id); if (row) for (const key of PENDING_KEYS) delete row[key]; });
}
function notePending(id: string, message: string) {
  update(s => { const row = s.schedules.find(y => y.id === id); if (row) row.pendingError = message; });
}
/** 待确认状态写不进缓存时不能静默：内存状态仍可见，同时留下带原因的诊断日志。 */
async function persistPending(reason: string) {
  try { await savePhoneCache(); }
  catch (e) { console.error(`[ST06] ${reason}，待确认状态未能写入本地缓存：${errText(e)}`); }
}
/** 只有任务 ID、版本都一致才允许复用原请求 ID；否则同一 ID 会把修改后的内容当作旧请求执行。 */
function pendingMatches(x: Schedule) {
  return !!x.pendingRun && !!x.pendingRunRevision && x.pendingRunTask === x.phoneTask && x.pendingRunRevision === (x.revision || '');
}
async function prepareRunRequest(x: Schedule): Promise<ScheduleAction> {
  const matches = pendingMatches(x);
  const reuse = matches && withinReconcileWindow(x);
  if (x.pendingRun && !matches) console.warn(`[ST06] 待确认请求 ${x.pendingRun} 与当前任务版本/参数不一致，按用户新的运行意图生成新请求 ID`);
  else if (x.pendingRun && !reuse) console.warn(`[ST06] 待确认请求 ${x.pendingRun} 已超过自动核对窗口，不再复用；按用户新的运行意图生成新请求 ID`);
  const requestId = reuse ? x.pendingRun! : crypto.randomUUID();
  x.pendingRun = requestId;
  x.pendingOp = 'schedule.run';
  x.pendingRunAt = reuse ? x.pendingRunAt || Date.now() : Date.now();
  x.pendingRunRuns = (reuse ? x.pendingRunRuns || 0 : 0) + 1;
  x.pendingRunTask = x.phoneTask;
  x.pendingRunRevision = x.revision || '';
  delete x.pendingError;
  update();
  try { await savePhoneCache(); }
  catch (e) {
    for (const key of PENDING_KEYS) delete x[key];
    update();
    throw new Error(`本次运行没有下发：本地缓存写入失败，请检查磁盘空间后重试（${errText(e)}）`);
  }
  return { id: x.phoneTask!, revision: x.revision || '', enabled: String(!x.enabled), request_id: requestId };
}
async function keepUnknownRun(x: Schedule, reason: string) {
  notePending(x.id, `运行结果未知（${reason}），已保留原请求；10 分钟内下次同步或重启会自动核对，超时后停止自动重试并需人工确认`);
  console.error(`[ST06] 运行请求 ${x.pendingRun} 结果未知，已保留待确认：${reason}`);
  await persistPending('保留结果未知的运行请求');
}
async function rejectRun(x: Schedule, reason: string): Promise<never> {
  clearPending(x.id);
  notePending(x.id, `手机未接受上次运行（${reason}），该请求未执行`);
  await persistPending('记录未执行的运行请求');
  throw new Error(`手机未接受本次运行（${reason}），该请求未执行`);
}
async function refreshConfirmedRun(x: Schedule) {
  try { await syncPhoneSchedules(x.exec); }
  catch (e) { console.error(`[ST06] 运行已确认，但手机任务列表同步失败，稍后自动重试：${errText(e)}`); }
}
export function phoneSchedule(device: string, row: PhoneSchedule, info: PhoneSchedules): Schedule {
  return { id: `ps:${device}:${row.id}`, phoneTask: row.id, revision: row.revision, editable: row.editable === 'true',
    exec: device, name: row.name, prompt: row.prompt, freq: row.freq as Schedule['freq'], time: row.time,
    days: JSON.parse(row.days).map((d: number) => d === 7 ? 0 : d), every: Number(row.every), enabled: row.enabled === 'true',
    runIn: row.session_id ? 'same' : 'new', conversationId: row.session_id, nextRun: Number(row.next) || undefined,
    last: Number(row.last) || null, timezone: info.timezone, exact: info.exact === 'true',
    runs: JSON.parse(row.runs).map((r: { firedAt: number; sessionId: string; preview: string; ok: boolean }) => ({ at: r.firedAt, sessionId: r.sessionId, note: r.preview, ok: r.ok })) };
}
export async function syncPhoneSchedules(device: string) {
  const info = await phoneRpc<PhoneSchedules>(device, 'schedule.list', {});
  const rows = (JSON.parse(info.items) as PhoneSchedule[]).map(r => phoneSchedule(device, r, info));
  const incoming = new Set(rows.map(r => r.id));
  for (const prev of S.schedules) if (prev.exec === device && prev.pendingRun && !incoming.has(prev.id)) {
    console.warn(`[ST06] 待确认运行所属任务已在手机删除，请求 ${prev.pendingRun} 的结果无法再核对`);
  }
  update(s => {
    for (const row of rows) {
      const prev = s.schedules.find(x => x.id === row.id);
      if (!prev) continue;
      /* 同步以手机为准，但结果未知的操作在确认前保留（含发起时的任务版本快照） */
      row.pendingRun = prev.pendingRun; row.pendingOp = prev.pendingOp;
      row.pendingRunAt = prev.pendingRunAt; row.pendingRunRuns = prev.pendingRunRuns;
      row.pendingRunTask = prev.pendingRunTask; row.pendingRunRevision = prev.pendingRunRevision;
      row.pendingError = prev.pendingError;
    }
    s.schedules = [...s.schedules.filter(x => x.exec !== device), ...rows];
  });
  await savePhoneCache();
}
export async function savePhoneSchedule(f: Schedule) {
  if (f.editable === false) throw new Error('这个任务含有高级手机配置，请在手机端编辑');
  const id = f.phoneTask || pendingCreates.get(f) || crypto.randomUUID();
  pendingCreates.set(f, id);
  const session = f.runIn === 'same' ? f.conversationId || S.convs.find(c => c.id === S.activeConv && c.owner === f.exec)?.phoneSession : '';
  if (f.runIn === 'same' && !session) throw new Error('请先打开这台手机的会话，再创建追加到原窗口的任务');
  const request: ScheduleWrite = { id, revision: f.revision || '', name: f.name, prompt: f.prompt, freq: f.freq,
    time: f.time, days: JSON.stringify(f.days.map(d => d === 0 ? 7 : d)), every: String(f.every), enabled: String(f.enabled), session_id: session || '' };
  await syncPhoneModel(f.exec);
  await phoneRpc(f.exec, 'schedule.save', request);
  await syncPhoneSchedules(f.exec);
}
/** 发送前先持久化，再下发：任何一步失败，待确认的操作都留在缓存里等重试或查询 */
export async function changePhoneSchedule(x: Schedule, method: 'schedule.toggle' | 'schedule.delete' | 'schedule.run') {
  if (method !== 'schedule.run') {
    const request: ScheduleAction = { id: x.phoneTask!, revision: x.revision || '', enabled: String(!x.enabled), request_id: crypto.randomUUID() };
    await phoneRpc<{ status: string }>(x.exec, method, request);
    await syncPhoneSchedules(x.exec);
    return;
  }
  const request = await prepareRunRequest(x);
  let reply: RunReply;
  try { reply = await phoneRpc<RunReply>(x.exec, 'schedule.run', request); }
  catch (e) {
    /* 结果未知：保留待确认请求，重启后复用同一 request_id 或查询结果，绝不生成新 ID */
    if (definitelyNotExecuted(e)) return rejectRun(x, errText(e));
    await keepUnknownRun(x, errText(e));
    throw e instanceof Error ? e : new Error(errText(e));
  }
  const outcome = runOutcome(reply);
  if (outcome === 'accepted') {
    /* 手机已确认接受：确认结果后才能清除待确认记录 */
    clearPending(x.id);
    await persistPending('运行已被手机接受');
    await refreshConfirmedRun(x);
    return;
  }
  if (outcome === 'failed') return rejectRun(x, `手机报告未能启动（${reply?.status || 'failed'}）`);
  /* dispatching 或协议外状态：请求可能仍在手机处理，保留原 ID 等下一次核对 */
  await keepUnknownRun(x, `手机仍在处理（${reply?.status || '未知状态'}）`);
  throw new Error('手机仍在处理，运行结果尚未确认；已保留原请求，稍后自动核对，请勿重复运行');
}
/** 重启后先补发或查询上一次未确认的运行请求；没有任何待确认操作时直接返回 */
export async function resolvePendingPhoneRuns(device: string) {
  const stale = S.schedules.filter(x => x.exec === device && x.phoneTask && x.pendingRun);
  let confirmed = false, changed = false;
  for (const x of stale) {
    const pendingId = x.pendingRun!;
    if (!pendingMatches(x)) {
      notePending(x.id, '任务在待确认期间被修改（版本或参数不一致），已暂停自动重发；请查看手机运行记录后再手动运行');
      console.warn(`[ST06] 待确认请求 ${pendingId} 与当前任务版本/参数不一致，已跳过自动重发`);
      changed = true;
      continue;
    }
    if (!withinReconcileWindow(x)) {
      /* 超过窗口后手机回执去重可能失效：保留错误记录，但不再自动重放，避免重复执行 */
      clearPending(x.id);
      notePending(x.id, '上次运行超过 10 分钟自动核对窗口，已停止自动重发；结果可能已在手机执行，请先查看手机运行记录确认，再手动运行');
      console.warn(`[ST06] 待确认请求 ${pendingId} 超过自动核对窗口，未重发，转人工确认`);
      changed = true;
      continue;
    }
    const request: ScheduleAction = { id: x.phoneTask!, revision: x.pendingRunRevision!, enabled: String(!x.enabled), request_id: pendingId };
    let reply: RunReply;
    try { reply = await phoneRpc<RunReply>(device, 'schedule.run', request); }
    catch (e) {
      changed = true;
      if (definitelyNotExecuted(e)) {
        clearPending(x.id);
        notePending(x.id, `手机未接受上次运行（${errText(e)}），该请求未执行`);
      } else {
        notePending(x.id, `上次运行结果仍未知（${errText(e)}），已保留原请求，稍后继续核对`);
        console.error(`[ST06] 恢复待确认请求 ${pendingId} 失败，结果仍未知：${errText(e)}`);
      }
      continue;
    }
    changed = true;
    const outcome = runOutcome(reply);
    if (outcome === 'accepted') { clearPending(x.id); confirmed = true; }
    else if (outcome === 'failed') { clearPending(x.id); notePending(x.id, `手机未能开始上次运行（${reply?.status || 'failed'}），该次未执行`); }
    else notePending(x.id, `手机仍在处理上次运行（${reply?.status || '未知状态'}），结果未知；稍后继续核对`);
  }
  if (confirmed) {
    try { await syncPhoneSchedules(device); }
    catch (e) { console.error(`[ST06] 待确认运行已确认，但手机任务列表同步失败，稍后自动重试：${errText(e)}`); }
  }
  if (changed) {
    try { await savePhoneCache(); }
    catch (e) { console.error(`[ST06] 待确认状态变化未能写入本地缓存：${errText(e)}`); throw e; }
  }
}
export async function phoneScheduleResult(x: Schedule, index = 0) {
  const session = x.runs[index]?.sessionId;
  if (!session) return undefined;
  await syncPhoneHistory(x.exec);
  return S.convs.find(c => c.owner === x.exec && c.phoneSession === session)?.id;
}
