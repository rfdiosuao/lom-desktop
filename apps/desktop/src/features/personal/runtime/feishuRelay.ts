import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { inShell } from '@/core/platform';
import { authAccount, onAuthChange } from '@/features/account/runtime/authScope';
import { sendFromChannel } from '@/features/chat/runtime/tasks';
import { S, watchStore } from '@/state/store';
import type { Conv } from '@/state/types';
import { loadAssistants } from './catalog';
import { scopedFeishuStatus } from './feishuBinding';
import { sameFeishuScope, invalidateFeishuScope, recordFeishuScope, feishuStatus, type FeishuEventScope, type FeishuScope } from './feishu';
import { streamReply } from './feishuCard';
import { addTyping, removeTyping, replyText } from './feishuTurn';
import { consumeFeishuApprovalText, consumeFeishuApprovalAction } from './feishuApprovals';
import { ensureConversation } from './session';

export interface FeishuMessage extends FeishuEventScope { message_id: string; chat_id: string; text: string }
interface Relay { scope: FeishuScope; queue: Promise<void>; active: boolean }
const relays = new Map<string, Relay>();
const starting = new Map<string, Promise<void>>();
const revisions = new Map<string, number>();
let timer: ReturnType<typeof setInterval> | undefined;
const key = (account: string, assistantId: string) => JSON.stringify([account, assistantId]);
const current = (r: Relay) => r.active && S.cloud === 'signed-in' && S.account?.id === r.scope.account && relays.get(key(r.scope.account, r.scope.assistantId)) === r && loadAssistants(r.scope.account).items.some(a => a.id === r.scope.assistantId);

export async function stopFeishuRelay(account: string, assistantId: string) {
  const id = key(account, assistantId), relay = relays.get(id);
  revisions.set(id, (revisions.get(id) || 0) + 1);
  invalidateFeishuScope(account, assistantId);
  if (relay) relay.active = false;
  relays.delete(id);
  if (!inShell()) return;
  await Promise.all([invoke('feishu_approvals_stop', { account, assistantId }), invoke('feishu_listen_stop', { account, assistantId })]);
}
function connect(account: string, assistantId: string): Promise<void> {
  const id = key(account, assistantId), previous = starting.get(id);
  if (previous) return previous;
  if (relays.has(id)) return Promise.resolve();
  const pending = connectScope(account, assistantId).finally(() => {
    if (starting.get(id) === pending) starting.delete(id);
  });
  starting.set(id, pending);
  return pending;
}
async function connectScope(account: string, assistantId: string) {
  const id = key(account, assistantId), auth = authAccount();
  const revision = revisions.get(id) || 0;
  const valid = () => auth() && (revisions.get(id) || 0) === revision;
  const status = await scopedFeishuStatus(account, assistantId);
  if (!valid() || !(status.connected ?? status.authorized) || !status.app_id) return;
  const generation = await invoke<number>('feishu_listen_start', { account, assistantId });
  if (!valid() || !loadAssistants(account).items.some(a => a.id === assistantId)) { await stopFeishuRelay(account, assistantId); return; }
  const confirmed = await feishuStatus(account, assistantId);
  if (!valid() || confirmed.generation !== generation || confirmed.app_id !== status.app_id) { await stopFeishuRelay(account, assistantId); return; }
  const scope = { account, assistantId, appId: confirmed.app_id, generation };
  recordFeishuScope(scope);
  relays.set(id, { scope, queue: Promise.resolve(), active: true });
  await invoke('feishu_approvals_start', scope).catch(() => console.warn('feishu.approval_text_fallback'));
}

/** Start each configured bot independently; one slow bot never serializes another. */
export async function syncFeishuRelay() {
  if (!inShell()) return;
  const account = S.cloud === 'signed-in' ? S.account?.id : undefined;
  await Promise.all([...relays.values()].filter(r => r.scope.account !== account || !current(r)).map(r => stopFeishuRelay(r.scope.account, r.scope.assistantId)));
  if (account) await Promise.all(loadAssistants(account).items.map(a => connect(account, a.id).catch(e => console.warn('feishu.relay_sync_failed', e))));
}
export async function restartFeishuRelay(account?: string, assistantId?: string) {
  if (account && assistantId) {
    await stopFeishuRelay(account, assistantId);
    // Drain the invalidated start before retrying; its cleanup must finish before the replacement starts.
    await starting.get(key(account, assistantId))?.catch(e => console.warn('feishu.relay_superseded_start_failed', e));
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
  if (consumeFeishuApprovalText(msg.text, scope)) return;
  const a = loadAssistants(scope.account).items.find(a => a.id === scope.assistantId);
  if (!a) return;
  let c = S.convs.find(x => x.id === a.conversation && x.personal?.id === a.id);
  if (!c) { await ensureConversation(a); c = S.convs.find(x => x.id === a.conversation && x.personal?.id === a.id); }
  const fail = (text: string) => valid() ? replyText(scope, msg.message_id, text).catch(e => console.warn('feishu.reply_failed', e)) : Promise.resolve();
  if (!c || !valid()) { await fail('助理会话没有准备好，请打开 Lom 后重试。'); return; }
  const bound = () => valid() && S.convs.includes(c!);
  await idle(c, bound); if (!bound()) return;
  const sent = await sendFromChannel(c, msg.text, 'feishu', bound);
  if (!sent) { await fail('这条消息没有送到助理，请打开 Lom 查看。'); return; }
  if (bound()) await streamReply(scope, msg.message_id, c, sent, 300, bound);
}
export function startFeishuRelay() {
  if (timer || !inShell()) return;
  const sync = () => void syncFeishuRelay().catch(e => console.warn('feishu.relay_sync_failed', e));
  void listen<FeishuMessage>('feishu-message', e => {
    const msg = e.payload, r = relays.get(key(msg.account, msg.assistant_id));
    if (!r || !current(r) || !sameFeishuScope(r.scope, msg)) return;
    if (consumeFeishuApprovalText(msg.text, r.scope)) return;
    const typing = addTyping(r.scope, msg.message_id);
    r.queue = r.queue.then(() => handleFeishuMessage(msg, r)).catch(e => console.warn('feishu.relay_failed', e))
      .finally(() => current(r) ? removeTyping(r.scope, msg.message_id, typing) : undefined);
  });
  void listen<FeishuEventScope & { nonce: string; decision: string }>('feishu-approval', e => {
    const event = e.payload, r = relays.get(key(event.account, event.assistant_id));
    if (r && current(r) && sameFeishuScope(r.scope, event)) consumeFeishuApprovalAction(r.scope, event.nonce, event.decision);
  });
  void listen<FeishuEventScope>('feishu-listen-ended', e => {
    const r = relays.get(key(e.payload.account, e.payload.assistant_id));
    if (r && sameFeishuScope(r.scope, e.payload)) { invalidateFeishuScope(r.scope.account, r.scope.assistantId); r.active = false; relays.delete(key(r.scope.account, r.scope.assistantId)); }
  });
  onAuthChange(() => {
    const accounts = new Set([...relays.values()].map(r => r.scope.account));
    if (S.account?.id) accounts.add(S.account.id);
    for (const r of relays.values()) { r.active = false; invalidateFeishuScope(r.scope.account, r.scope.assistantId); }
    relays.clear();
    for (const account of accounts) void invoke('feishu_stop_account', { account }).catch(() => console.warn('feishu.stop_account_failed'));
  });
  timer = setInterval(sync, 60_000); sync();
}
