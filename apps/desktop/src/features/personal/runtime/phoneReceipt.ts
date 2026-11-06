import { authAccount, onAuthChange } from '@/features/account/runtime/authScope';
import { readJson, writeJson } from '@/features/account/runtime/localCache';
import { isTaskStopping } from '@/features/chat/runtime/cancel';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';
import { toast } from '@/shared/overlays/controller';
import { judgePhoneTurn, PHONE_NOT_STARTED, PHONE_TERMINAL, PHONE_UNCONFIRMED, receiptText, type TurnWatch } from './phoneTurn';

type Receipt = TurnWatch & { parent: string; assistant: string; child: string; device: string; session: string; terminal?: string };
const terminalStates = new Set([...PHONE_TERMINAL, PHONE_NOT_STARTED, PHONE_UNCONFIRMED]);
const key = () => S.cloud === 'signed-in' && S.account?.id ? `lom.personal-phone-receipts.v1:${S.account.id}` : '';
let loadedKey = '', pending: Receipt[] = [], delivering = false;
const restored = new WeakSet<Receipt>();
onAuthChange(() => { loadedKey = ''; pending = []; });

function validReceipt(value: unknown): value is Receipt {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<Receipt>;
  return [r.parent, r.assistant, r.child, r.device, r.session].every(v => typeof v === 'string' && !!v)
    && (r.terminal === undefined || terminalStates.has(r.terminal))
    && [r.armedAt, r.seen, r.read].every(v => v === undefined || Number.isFinite(v));
}

function load() {
  const accountKey = key();
  if (!accountKey) return false;
  if (accountKey === loadedKey) return true;
  const read = readJson(accountKey, value => Array.isArray(value) && value.length <= 100 && value.every(validReceipt) ? value as Receipt[] : undefined);
  if (read.status === 'invalid' || read.status === 'unavailable') return false;
  // 旧版本留下的回执没有派发时刻，无法证明哪个终态属于它：窗口从现在算起，之前的状态不算。
  pending = read.status === 'ok' ? read.value.map(r => ({ ...r, armedAt: r.armedAt ?? Date.now() })) : [];
  for (const r of pending) if (!r.terminal) restored.add(r);
  loadedKey = accountKey;
  return true;
}

function save(next: Receipt[]) {
  if (!loadedKey || loadedKey !== key() || writeJson(loadedKey, next) !== 'ok') return false;
  pending = next;
  return true;
}

/** armedAt 必须是发出派发之前取的电脑时刻：只有这之后出现的手机消息和运行态才算本轮。 */
export function registerPhoneReceipt(parent: Conv, child: Conv, armedAt: number) {
  if (!child.phoneSession || !parent.personal?.id || !S.convs.includes(parent) || !S.convs.includes(child)) return;
  if (!load() || pending.length >= 100 || !save([...pending, {
    parent: parent.id, assistant: parent.personal.id, child: child.id, device: child.owner, session: child.phoneSession, armedAt,
  }])) {
    toast('手机已接收任务，但回执记录无法保存，请在原会话查看结果。', 'info');
    return;
  }
  observePersonalPhoneReceipt(child);
}

const matches = (r: Receipt, c: Conv) => r.child === c.id && r.device === c.owner && r.session === c.phoneSession;

/** read 表示这次是刚从手机读到状态（running 为手机当时报告的是否在运行）；没有 read 时只复核已有证据，不当作读过手机。 */
export function observePersonalPhoneReceipt(child: Conv, read?: { running: boolean }) {
  if (!S.convs.includes(child) || !load()) return;
  const now = Date.now(), running = !!S.running[child.id];
  const next = pending.map(r => {
    if (!matches(r, child) || r.terminal || restored.has(r)) return r;
    const seen = r.seen ?? (read?.running ? now : undefined), readAt = r.read ?? (read ? now : undefined);
    const terminal = judgePhoneTurn(child, { armedAt: r.armedAt, seen, read: readAt }, running, now);
    return seen === r.seen && readAt === r.read && !terminal ? r : { ...r, seen, read: readAt, ...(terminal ? { terminal } : {}) };
  });
  if (next.some((r, i) => r !== pending[i])) save(next);
}

/** Called before admitting another request for the same phone conversation. */
export function supersedePersonalPhoneReceipt(child: Conv) {
  observePersonalPhoneReceipt(child);
  if (!load()) return;
  const next = pending.filter(r => !matches(r, child) || r.terminal);
  if (next.length !== pending.length && !save(next)) throw new Error('手机回执记录无法更新，未发送新任务');
}

/** 重启后恢复的回执要先重新读手机；派发后手机还没动静（没在运行、也没有终态）的回执，隔一阵再读一次——盯会话的轮询在手机报告"没在跑"时就停了。 */
async function recover(r: Receipt, child: Conv, live: () => boolean) {
  const wasRestored = restored.has(r);
  if (!wasRestored && (r.terminal || r.seen !== undefined || S.running[child.id])) return;
  if (child.phonePending || S.agents[child.owner]?.status !== 'online') return;
  try {
    const { refreshPhoneChat } = await import('@/features/phones/runtime/phoneChat');
    if (!live() || !pending.includes(r)) return;
    await refreshPhoneChat(child);
    if (!live() || !pending.includes(r)) return;
    restored.delete(r);
    observePersonalPhoneReceipt(child, { running: !!S.running[child.id] });
  } catch {
    // Connection and cache failures leave the stored receipt pending for a fresh read.
    console.warn('personal.phone_receipt_recover_failed');
  }
}

async function deliver(receipt: Receipt, parent: Conv, child: Conv, live: () => boolean) {
  if (S.running[parent.id] || isTaskStopping(parent.id)) return;
  const { sendFromChannel } = await import('@/features/chat/runtime/tasks');
  if (!live() || !pending.includes(receipt) || S.running[parent.id] || isTaskStopping(parent.id)) return;
  // Record consumption before sending. An interrupted send is never automatically replayed.
  if (!save(pending.filter(r => r !== receipt))) return;
  const message = receiptText(child.id, receipt.terminal ?? '');
  try {
    if (!await sendFromChannel(parent, message, 'phone_receipt', live) && live()) toast('手机任务已结束，请打开原会话查看结果。', 'phone');
  } catch {
    if (live()) toast('手机任务已结束，个人助理的回执发送未确认，请查看原会话。', 'phone');
  }
}

export async function tickPersonalPhoneReceipts() {
  if (delivering || S.conn !== 'ready' || !load() || !pending.length) return;
  const authenticated = authAccount();
  delivering = true;
  try {
    for (const r of pending) {
      if (!authenticated()) break;
      const parent = S.convs.find(c => c.id === r.parent && c.personal?.id === r.assistant);
      const child = S.convs.find(c => matches(r, c));
      if (!parent || !child) continue; // Phone cache and Core conversations can load after the queue.
      const live = () => authenticated() && S.convs.includes(parent) && parent.personal?.id === r.assistant && S.convs.includes(child) && matches(r, child);
      if (!pending.includes(r)) continue;
      await recover(r, child, live);
      if (!live()) continue;
      observePersonalPhoneReceipt(child);
      const ready = pending.find(row => matches(row, child) && row.parent === r.parent && row.assistant === r.assistant && row.terminal);
      if (ready) await deliver(ready, parent, child, live);
    }
  } finally { delivering = false; }
}
