import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { inShell } from '@/core/platform';
import { authAccount, onAuthChange } from '@/features/account/runtime/authScope';
import { sendFromChannel } from '@/features/chat/runtime/tasks';
import { S, watchStore } from '@/state/store';
import type { Conv } from '@/state/types';
import { loadAssistants } from './catalog';
import { scopedFeishuStatus } from './feishuBinding';
import { sameFeishuScope, invalidateFeishuScope, recordFeishuScope, feishuStatus, type FeishuStep, type FeishuEventScope, type FeishuScope } from './feishu';
import { beginFeishuHealth, markFeishuHealth } from './feishuHealth';
import { streamReply } from './feishuCard';
import { addTyping, removeTyping, replyText } from './feishuTurn';
import { consumeFeishuApprovalText, consumeFeishuApprovalAction } from './feishuApprovals';
import { ensureConversation } from './session';
import { reserveFeishuMessage, clearFeishuMessageHistory } from './feishuDedup';

export interface FeishuMessage extends FeishuEventScope { message_id: string; chat_id: string; text: string }
interface Relay { scope: FeishuScope; queue: Promise<void>; active: boolean }
const relays = new Map<string, Relay>();
const arriving = new Map<string, FeishuMessage[]>();
const starting = new Map<string, Promise<void>>();
const retries = new Map<string, { timer: ReturnType<typeof setTimeout>; delay: number }>();
const attempts = new Map<string, number>();
const revisions = new Map<string, number>();
let authCleanup: Promise<unknown> = Promise.resolve();
let timer: ReturnType<typeof setInterval> | undefined;
const key = (account: string, assistantId: string) => JSON.stringify([account, assistantId]);
const current = (r: Relay) => r.active && S.cloud === 'signed-in' && S.account?.id === r.scope.account && relays.get(key(r.scope.account, r.scope.assistantId)) === r && loadAssistants(r.scope.account).items.some(a => a.id === r.scope.assistantId);

export async function stopFeishuRelay(account: string, assistantId: string) {
  const id = key(account, assistantId), relay = relays.get(id);
  const retry = retries.get(id);
  if (retry) clearTimeout(retry.timer);
  retries.delete(id); attempts.delete(id); arriving.delete(id);
  revisions.set(id, (revisions.get(id) || 0) + 1);
  invalidateFeishuScope(account, assistantId);
  if (relay) { relay.active = false; markFeishuHealth(relay.scope, 'stopped'); }
  relays.delete(id);
  if (!inShell()) return;
  await Promise.all([invoke('feishu_approvals_stop', { account, assistantId }), invoke('feishu_listen_stop', { account, assistantId })]);
}
function connect(account: string, assistantId: string): Promise<void> {
  const id = key(account, assistantId), previous = starting.get(id);
  if (previous) return previous;
  const pending = connectScope(account, assistantId).catch(() => {
    const relay = relays.get(id);
    if (relay && current(relay)) markFeishuHealth(relay.scope, 'error');
    console.warn('feishu.status_check_failed');
  }).finally(() => {
    if (starting.get(id) === pending) { starting.delete(id); arriving.delete(id); }
  });
  starting.set(id, pending);
  return pending;
}
function recover(scope: FeishuScope) {
  const id = key(scope.account, scope.assistantId);
  if (retries.has(id)) return;
  const auth = authAccount(), revision = revisions.get(id) || 0;
  const delay = Math.min(30_000, 1000 * 2 ** (attempts.get(id) || 0));
  attempts.set(id, (attempts.get(id) || 0) + 1);
  const timer = setTimeout(() => {
    retries.delete(id);
    if (!auth() || (revisions.get(id) || 0) !== revision) return;
    void connect(scope.account, scope.assistantId).catch(() => console.warn('feishu.reconnect_failed'));
  }, delay);
  retries.set(id, { timer, delay });
}
async function connectScope(account: string, assistantId: string) {
  const id = key(account, assistantId), auth = authAccount();
  const revision = revisions.get(id) || 0;
  const valid = () => auth() && (revisions.get(id) || 0) === revision;
  const status = await scopedFeishuStatus(account, assistantId);
  const previous = relays.get(id);
  if (!valid()) return;
  if (previous && (status.connected ?? status.authorized) && current(previous) && status.app_id === previous.scope.appId && status.generation === previous.scope.generation && status.listener_running !== false) return;
  if (previous) { previous.active = false; relays.delete(id); invalidateFeishuScope(account, assistantId); }
  if (!valid() || !(status.connected ?? status.authorized) || !status.app_id) return;
  const pendingScope = { account, assistantId, appId: status.app_id, generation: status.generation };
  beginFeishuHealth(pendingScope, 'starting');
  let generation: number;
  try { generation = await invoke<number>('feishu_listen_start', { account, assistantId }); }
  catch { markFeishuHealth(pendingScope, 'error'); console.warn('feishu.listener_start_failed'); return; }
  if (!valid() || !loadAssistants(account).items.some(a => a.id === assistantId)) { await stopFeishuRelay(account, assistantId); return; }
  const confirmed = await feishuStatus(account, assistantId);
  if (!valid() || confirmed.generation !== generation || confirmed.app_id !== status.app_id || confirmed.listener_running === false) { await stopFeishuRelay(account, assistantId); beginFeishuHealth({ ...pendingScope, generation }, 'error'); return; }
  const scope = { account, assistantId, appId: confirmed.app_id, generation };
  recordFeishuScope(scope);
  beginFeishuHealth(scope, 'running');
  relays.set(id, { scope, queue: Promise.resolve(), active: true });
  for (const msg of arriving.get(id) || []) receive(msg);
  arriving.delete(id);
  await invoke('feishu_approvals_start', scope).catch(() => console.warn('feishu.approval_text_fallback'));
}

/** Start each configured bot independently; one slow bot never serializes another. */
export async function syncFeishuRelay() {
  if (!inShell()) return;
  await authCleanup;
  const account = S.cloud === 'signed-in' ? S.account?.id : undefined;
  await Promise.all([...relays.values()].filter(r => r.scope.account !== account || !current(r)).map(r => stopFeishuRelay(r.scope.account, r.scope.assistantId)));
  if (account) await Promise.all(loadAssistants(account).items.map(a => connect(account, a.id).catch(() => console.warn('feishu.relay_sync_failed'))));
}
export async function restartFeishuRelay(account?: string, assistantId?: string) {
  if (account && assistantId) {
    await stopFeishuRelay(account, assistantId);
    // Drain the invalidated start before retrying; its cleanup must finish before the replacement starts.
    await starting.get(key(account, assistantId))?.catch(() => console.warn('feishu.relay_superseded_start_failed'));
  }
  await syncFeishuRelay();
}
const idle = (c: Conv, valid: () => boolean) => new Promise<void>(resolve => {
  const check = () => { if (!valid() || !S.running[c.id]) { stop(); resolve(); } };
  const stop = watchStore(check); check();
});
export async function handleFeishuMessage(msg: FeishuMessage, delivery?: Relay) {
  const r = delivery || relays.get(key(msg.account, msg.assistant_id));
  if (!r || !sameFeishuScope(r.scope, msg) || !current(r)) return;
  const valid = () => current(r), scope = r.scope;
  markFeishuHealth(scope, 'received');
  attempts.delete(key(scope.account, scope.assistantId));
  if (consumeFeishuApprovalText(msg.text, scope)) return;
  const a = loadAssistants(scope.account).items.find(a => a.id === scope.assistantId);
  if (!a) return;
  let c = S.convs.find(x => x.id === a.conversation && x.personal?.id === a.id);
  if (!c) { await ensureConversation(a); c = S.convs.find(x => x.id === a.conversation && x.personal?.id === a.id); }
  const fail = async (text: string) => {
    if (!valid()) return;
    markFeishuHealth(scope, 'route_failed');
    try { await replyText(scope, msg.message_id, text); }
    catch { markFeishuHealth(scope, 'reply_failed'); console.warn('feishu.reply_failed'); }
  };
  if (!c || !valid()) { await fail('助理会话没有准备好，请打开 Lom 后重试。'); return; }
  const bound = () => valid() && S.convs.includes(c!);
  await idle(c, bound); if (!bound()) return;
  // A stale, undispatched reservation can be replaced by the new generation.
  // Only the actual POST boundary commits it; unknown outcomes stay deduplicated.
  const reservation = reserveFeishuMessage(scope, msg.message_id, bound);
  if (!reservation) return;
  let sent: Awaited<ReturnType<typeof sendFromChannel>>;
  try { sent = await sendFromChannel(c, msg.text, 'feishu', bound, reservation.dispatched); }
  finally { reservation.releaseUnsent(); }
  if (!sent) { await fail('这条消息没有送到助理，请打开 Lom 查看。'); return; }
  if (bound()) {
    markFeishuHealth(scope, 'routed');
    try {
      const replied = await streamReply(scope, msg.message_id, c, sent, 300, bound);
      if (bound()) markFeishuHealth(scope, replied === true ? 'replied' : 'reply_failed');
    } catch { if (bound()) markFeishuHealth(scope, 'reply_failed'); console.warn('feishu.reply_failed'); }
  }
}
function receive(msg: FeishuMessage) {
  const id = key(msg.account, msg.assistant_id), r = relays.get(id);
  if (!r) {
    // A child can emit before listen_start returns. Keep only a bounded startup window;
    // confirmed full scope below decides whether any queued event may be delivered.
    if (starting.has(id) && S.cloud === 'signed-in' && S.account?.id === msg.account) {
      const queue = arriving.get(id) || [];
      queue.push(msg); if (queue.length > 32) queue.shift();
      arriving.set(id, queue);
    }
    return;
  }
  if (!current(r) || !sameFeishuScope(r.scope, msg)) return;
  if (consumeFeishuApprovalText(msg.text, r.scope)) return;
  markFeishuHealth(r.scope, 'received');
  const typing = addTyping(r.scope, msg.message_id);
  r.queue = r.queue.then(() => handleFeishuMessage(msg, r)).catch(() => { markFeishuHealth(r.scope, 'route_failed'); console.warn('feishu.relay_failed'); })
    .finally(() => current(r) ? removeTyping(r.scope, msg.message_id, typing) : undefined);
}
async function listenFeishuRelay() {
  await listen<FeishuStep>('feishu-connect', e => {
    const event = e.payload;
    if (event.ok && S.cloud === 'signed-in' && S.account?.id === event.account) {
      void syncFeishuRelay().catch(() => console.warn('feishu.relay_sync_failed'));
    }
  });
  await listen<FeishuMessage>('feishu-message', e => receive(e.payload));
  await listen<FeishuEventScope & { nonce: string; decision: string }>('feishu-approval', e => {
    const event = e.payload, r = relays.get(key(event.account, event.assistant_id));
    if (r && current(r) && sameFeishuScope(r.scope, event)) consumeFeishuApprovalAction(r.scope, event.nonce, event.decision);
  });
  await listen<FeishuEventScope>('feishu-listen-ended', e => {
    const r = relays.get(key(e.payload.account, e.payload.assistant_id));
    if (r && sameFeishuScope(r.scope, e.payload)) {
      markFeishuHealth(r.scope, 'error');
      invalidateFeishuScope(r.scope.account, r.scope.assistantId);
      r.active = false; relays.delete(key(r.scope.account, r.scope.assistantId));
      recover(r.scope);
    }
  });
}
export function startFeishuRelay() {
  if (timer || !inShell()) return;
  const sync = () => void syncFeishuRelay().catch(() => console.warn('feishu.relay_sync_failed'));
  const ready = listenFeishuRelay();
  let identity = '';
  watchStore(() => {
    const next = S.cloud === 'signed-in' ? S.account?.id || '' : '';
    if (identity === next) return;
    identity = next;
    void ready.then(sync).catch(() => console.warn('feishu.event_listener_failed'));
  });
  onAuthChange(() => {
    const accounts = new Set([...relays.values()].map(r => r.scope.account));
    if (S.account?.id) accounts.add(S.account.id);
    for (const r of relays.values()) { markFeishuHealth(r.scope, 'stopped'); r.active = false; invalidateFeishuScope(r.scope.account, r.scope.assistantId); }
    relays.clear(); arriving.clear(); clearFeishuMessageHistory();
    // Drain old native cleanup before starting a new auth generation, including same-account login.
    identity = '';
    for (const retry of retries.values()) clearTimeout(retry.timer);
    retries.clear(); attempts.clear();
    authCleanup = Promise.all([
      authCleanup, ...starting.values(),
      ...[...accounts].map(account => invoke('feishu_stop_account', { account }).catch(() => console.warn('feishu.stop_account_failed'))),
    ]).catch(() => console.warn('feishu.auth_cleanup_failed'));
  });
  timer = setInterval(() => { void ready.then(sync).catch(() => console.warn('feishu.event_listener_failed')); }, 60_000);
  void ready.then(sync).catch(() => console.warn('feishu.event_listener_failed'));
}
