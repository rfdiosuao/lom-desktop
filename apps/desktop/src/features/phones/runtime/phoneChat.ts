import { expandContextFiles } from '@/shared/lib/contextFiles';
import { publicationPolicy } from '@/features/settings/runtime/preferences';
import { audit } from '@/features/settings/runtime/audit';
import { toast, toastError } from '@/shared/overlays/controller';
import { uploadPhoneFile } from './phoneFiles';
import { phoneMessages, type PhoneRow } from './phoneMessages';
import { savePhoneCache } from './phoneCache';
import { taskFinished } from '@/app/sound';
import { phoneRpc } from './phoneRpc';
import { ensurePhoneModel, syncPhoneModel } from './phoneModel';
import { S, update } from '@/state/store';
import type { Conv, Msg, DraftAttachment } from '@/state/types';

interface Snapshot { items: PhoneRow[]; total: number; next: number; running: boolean; status: string; error: string; }
interface ListRow { id: string; title: string; updated: number; running: boolean; pinned: boolean }
interface ListPage { items: ListRow[]; total: number; next: number }

const watching = new Set<string>();
const sending = new Set<string>();
/** Raw phone rows per conversation. Polls re-read only the tail, so a streaming reply costs one small page, not the whole history. */
const rows = new Map<string, PhoneRow[]>();
/** The streaming reply and the row before it may still change; everything earlier is settled. */
const TAIL = 2;
/** Poll pacing while the phone is replying: start at 1 s, back off to 4 s while nothing changes, 8 s when not on screen. */
const FAST = 1000, SLOW = 4000, AWAY = 8000;
/** Signature of each phone's first session-list page; an unchanged first page means nothing to re-sync. */
const listSig = new Map<string, string>();

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** 正在发送、正在盯着、或有未确认请求的会话，运行态由发送/轮询流程自己维护。 */
const ownsRunState = (c: Conv) => watching.has(c.id) || sending.has(c.id) || !!c.phonePending;

async function chatSend(c: Conv, request: Record<string, string>, current?: () => boolean) {
  const { policy, ...body } = request;
  const payload = { ...body, text: policy ? `${policy}\n\n${request.text}` : request.text };
  try {
    if (current && !current()) throw new Error('总指挥已停止，未向手机发送任务');
    return await phoneRpc<{ session_id: string }>(c.owner, 'chat.send', payload);
  }
  catch (e) {
    // The phone lost its model config (reinstall, data cleared): push it again once, then retry the same request id.
    if (!(e instanceof Error) || e.message !== 'chat.model_missing') throw e;
    await syncPhoneModel(c.owner, true);
    if (current && !current()) throw new Error('总指挥已停止，未向手机重新发送任务');
    return phoneRpc<{ session_id: string }>(c.owner, 'chat.send', payload);
  }
}

export async function sendPhone(c: Conv, text: string, attachments: DraftAttachment[] = [], current?: () => boolean) {
  if (sending.has(c.id)) throw new Error('正在发送，请稍候');
  sending.add(c.id);
  try {
    if (S.running[c.id]) throw new Error('手机正在回复，请等待或停止当前任务');
    const previous = c.phonePending;
    if (previous && previous.text !== text) throw new Error('上一条消息结果尚未确认，请先重试原消息，避免重复执行');
    const ids: string[] = [];
    if (!previous) for (const a of expandContextFiles(attachments)) ids.push(await uploadPhoneFile(c.owner, a));
    const request = previous || { client_id: crypto.randomUUID(), session_id: c.phoneSession || '', text, policy: publicationPolicy(), files: JSON.stringify(ids) };
    await ensurePhoneModel(c.owner);
    if (current && !current()) throw new Error('总指挥已停止，未向手机发送任务');
    c.phonePending = request;
    await savePhoneCache();
    if (current && !current()) {
      if (!previous) { delete c.phonePending; await savePhoneCache(); }
      throw new Error('总指挥已停止，未向手机发送任务');
    }
    const reply = await chatSend(c, request, current);
    delete c.phonePending;
    update(s => { c.phoneSession = reply.session_id; c.phoneRunStatus = 'accepted'; s.running[c.id] = true; c.updated = Date.now(); });
    try { await savePhoneCache(); }
    catch (e) { toastError('消息已发送，但电脑本地记录保存失败', e); }
    void watchPhone(c);
  } finally { sending.delete(c.id); }
}

async function readRows(c: Conv, from: number) {
  let offset = from, snapshot: Snapshot;
  const fetched: PhoneRow[] = [];
  do {
    snapshot = await phoneRpc<Snapshot>(c.owner, 'chat.read', { session_id: c.phoneSession, offset });
    fetched.push(...snapshot.items);
    if (snapshot.next <= offset && snapshot.next < snapshot.total) throw new Error('手机历史记录分页异常');
    offset = snapshot.next;
  } while (offset < snapshot.total);
  return { snapshot, fetched };
}

/** Re-reads the phone conversation; returns whether anything visible changed. `full` re-reads the whole history. */
export async function refreshPhoneChat(c: Conv, full = false): Promise<boolean> {
  if (!c.phoneSession) return false;
  const known = rows.get(c.id);
  let from = !full && known ? Math.max(0, known.length - TAIL) : 0;
  let { snapshot, fetched } = await readRows(c, from);
  // The re-read tail must line up with what we hold; if not (history rewritten, live view vs stored rows), reload everything.
  if (from > 0 && (snapshot.total < from || fetched[0]?.id !== known?.[from]?.id)) {
    from = 0;
    ({ snapshot, fetched } = await readRows(c, 0));
  }
  const settled = from ? (known ?? []).slice(0, from) : [];
  const changed = !known || known.length !== settled.length + fetched.length || JSON.stringify(known.slice(from)) !== JSON.stringify(fetched);
  if (changed) rows.set(c.id, [...settled, ...fetched]);
  const finished = !!S.running[c.id] && !snapshot.running;
  const runStatus = snapshot.error ? 'failed' : snapshot.status;
  const stateChanged = !c.loaded || !!S.running[c.id] !== snapshot.running || c.phoneRunStatus !== runStatus;
  if (changed || stateChanged) {
    const messages: Msg[] = (rows.get(c.id) ?? []).flatMap(m => phoneMessages(m, c.owner, c.updated, c.phoneSession));
    update(s => { c.messages = messages; c.loaded = true; c.phoneRunStatus = runStatus; c.phoneSyncedAt = Date.now(); s.running[c.id] = snapshot.running; });
  }
  if (finished && !snapshot.error && ['completed', 'idle'].includes(snapshot.status)) taskFinished(c.id);
  if (finished && S.prefs.notifyHelp && (snapshot.error || ['failed', 'timeout', 'interrupted'].includes(snapshot.status))) toast(`${S.agents[c.owner]?.name || '手机'}的任务需要帮助，请检查会话。`, 'info');
  if (changed) for (const row of fetched) for (const block of row.blocks || []) if (block.kind === 'tool_use') audit(c.id, block.id, 'phone_tool', block.status);
  // While the phone streams, the cache is written once the reply settles, not on every poll.
  if (snapshot.error && (changed || finished || stateChanged)) update(() => { c.messages.push({ id: crypto.randomUUID(), type: 'system', at: Date.now(), text: snapshot.error }); });
  if ((changed || stateChanged) && !snapshot.running) await savePhoneCache();
  return changed || stateChanged;
}

export async function watchPhone(c: Conv) {
  if (watching.has(c.id)) return;
  watching.add(c.id);
  let wait = FAST, failures = 0;
  const account = S.account?.id;
  try {
    do {
      let changed: boolean;
      try { changed = await refreshPhoneChat(c); failures = 0; }
      catch (e) {
        if (account !== S.account?.id || S.cloud !== 'signed-in') break;
        if (!failures++) {
          update(() => { c.phoneRunStatus = 'unknown'; c.messages.push({ id: crypto.randomUUID(), type: 'system', at: Date.now(), text: '连接中断，手机执行状态未知。可以重试同步，任务不会自动重发。' }); });
          toastError('同步手机会话失败', e);
        }
        if (!S.prefs.reconnect || !S.agents[c.owner]?.real) break;
        await sleep(Math.min(30000, 2000 * 2 ** Math.min(failures - 1, 4)));
        if (!S.prefs.reconnect) break;
        continue;
      }
      if (!S.running[c.id]) break;
      wait = changed ? FAST : Math.min(Math.round(wait * 1.5), SLOW);
      await sleep(S.activeConv === c.id && !document.hidden ? wait : AWAY);
    } while (S.cloud === 'signed-in' && account === S.account?.id);
  } finally { watching.delete(c.id); }
}

export async function stopPhone(c: Conv) {
  if (!c.phoneSession) return;
  try { await phoneRpc(c.owner, 'chat.cancel', { session_id: c.phoneSession }); await refreshPhoneChat(c); }
  catch (e) { toastError('手机尚未确认停止', e); }
}

const signature = (page: ListPage) => JSON.stringify([page.total, page.items.map(r => [r.id, r.title, r.updated, r.pinned, r.running])]);

/** Syncs the phone's session list. `quick` stops after the first page when it is unchanged (sessions are ordered by last update,
 *  so any new, renamed or updated session moves onto it). Returns whether the list was re-synced. */
export async function syncPhoneHistory(device: string, quick = false): Promise<boolean> {
  let offset = 0;
  let page = await phoneRpc<ListPage>(device, 'chat.list', { offset });
  const sig = signature(page);
  if (quick && listSig.get(device) === sig) return false;
  const seen = new Set<string>();
  do {
    const current = page;
    update(s => {
      for (const row of current.items) {
        seen.add(row.id);
        const c = s.convs.find(x => x.owner === device && x.phoneSession === row.id);
        if (c) { c.title = row.title; c.updated = row.updated; c.pinned = row.pinned; }
        else s.convs.push({ id: `phone:${device}:${row.id}`, phoneSession: row.id, owner: device, title: row.title, updated: row.updated, pinned: row.pinned, messages: [] });
        // 没打开的会话不会被轮询，列表是手机告诉电脑“它在运行”的唯一来源；正在发送或盯着的会话由各自的流程维护，列表不覆盖。
        if (!c || !ownsRunState(c)) s.running[c?.id ?? `phone:${device}:${row.id}`] = !!row.running;
      }
    });
    if (page.next >= page.total) break;
    if (page.next <= offset) throw new Error('手机会话列表分页异常');
    offset = page.next;
    page = await phoneRpc<ListPage>(device, 'chat.list', { offset });
  } while (true);
  update(s => {
    // 手机上已删除的会话：一并清掉运行态，不留下永远转圈的 Logo
    const gone = s.convs.filter(c => c.owner === device && c.phoneSession && !seen.has(c.phoneSession) && !c.phonePending);
    for (const c of gone) delete s.running[c.id];
    s.convs = s.convs.filter(c => !gone.includes(c));
  });
  listSig.set(device, sig);
  await savePhoneCache();
  return true;
}

export async function changePhoneChat(c: Conv, method: 'chat.rename' | 'chat.delete' | 'chat.pin', values: Record<string, unknown> = {}) {
  if (!c.phoneSession) throw new Error('这条手机会话尚未确认');
  await phoneRpc(c.owner, method, { session_id: c.phoneSession, ...values });
  await syncPhoneHistory(c.owner);
}
