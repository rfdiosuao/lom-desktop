import { api } from '@/core/client';
import type { CoreConfirmation } from '@/core/types';
import { S, update } from '@/state/store';
import type { Conv } from '@/state/types';
import { toastError } from '@/shared/overlays/controller';
import { loadHistory } from './history';
import { recoveredMessages } from './recoveredMessages';
import { restoreConfirmations } from './tasks';
import { hasInFlightSend, hasUnconfirmedSend, pendingSends, reconcileSendRegistrations } from './cancel';

interface Runtime { is_processing: boolean; turn_id?: string | null; pending_confirmations?: number; }
interface Snapshot { runtime?: Runtime; extra?: { backend?: string }; }
let generation = 0;
const attempts = new Map<string, number>();
const deferred = new Set<string>();
const runtimeOf = (c: Conv) => api<Snapshot>('GET', `/api/conversations/${c.id}`);
const marker = (c: Conv) => JSON.stringify([c.messages, c.turnId, c.agentBackend, S.running[c.id]]);
const runtimeMarker = (r: Runtime) => JSON.stringify([r.is_processing, r.turn_id, r.pending_confirmations]);

async function recoverTask(c: Conv, attempt: number): Promise<boolean> {
  if (hasInFlightSend(c.id)) return false;
  const original = marker(c);
  const first = await runtimeOf(c);
  if (!first.runtime) throw new Error('chat.runtime_missing：核心没有返回任务运行状态');
  const [history, confirmations] = await Promise.all([
    loadHistory(c), api<CoreConfirmation[]>('GET', `/api/conversations/${c.id}/confirmations`),
  ]);
  const last = await runtimeOf(c);
  if (attempt !== attempts.get(c.id) || !S.convs.includes(c)) return true;
  if (!last.runtime) throw new Error('chat.runtime_missing：核心没有返回任务运行状态');
  if (hasInFlightSend(c.id) || marker(c) !== original || runtimeMarker(first.runtime) !== runtimeMarker(last.runtime)) return false;
  const runtime = last.runtime;
  update(s => {
    const accepted = c.messages.filter(m => m.type === 'user' && m.remoteId &&
      history.messages.some(saved => saved.type === 'user' && saved.remoteId === m.remoteId)).map(m => m.id);
    c.messages = recoveredMessages(history.messages, c.messages, runtime.is_processing && c.turnId === runtime.turn_id);
    c.agentBackend = last.extra?.backend ?? c.agentBackend;
    c.turnId = runtime.turn_id || undefined;
    const registered = reconcileSendRegistrations(c.id, accepted, c.turnId);
    if (runtime.is_processing || !registered) s.running[c.id] = true;
    else delete s.running[c.id];
    c.loaded = true;
    if (history.previewFile) { c.previewFile = history.previewFile; c.preview = 'ready'; }
    else if (c.preview === 'building' && !runtime.is_processing) c.preview = c.previewFile ? 'ready' : null;
    restoreConfirmations(c, confirmations);
  });
  return true;
}

async function recover(c: Conv, attempt: number, strict = false) {
  try {
    for (let retry = 0; retry < 3; retry++) {
      if (await recoverTask(c, attempt)) {
        if (attempt === attempts.get(c.id) && !hasUnconfirmedSend(c.id)) deferred.delete(c.id);
        return;
      }
    }
    if (strict) throw new Error('会话仍在更新，请重新打开后重试');
    if (attempt !== attempts.get(c.id)) return;
    // Live updates won the race. Keep them and retry when the current turn settles.
    deferred.add(c.id);
    console.info('chat.recovery_deferred', c.id);
    const pending = pendingSends.get(c.id);
    if (pending) void pending.then(() => retryDeferredRecovery(c.id), () => retryDeferredRecovery(c.id));
  } catch (error) {
    if (strict) throw error;
    if (attempt !== attempts.get(c.id)) return;
    deferred.add(c.id);
    toastError('恢复任务记录失败，可以重新打开任务重试', error);
  }
}

export async function recoverLoadedTasks() {
  const remaining = S.convs.filter(c => c.remote && c.loaded);
  await Promise.all(Array.from({ length: Math.min(4, remaining.length) }, async () => {
    let c: Conv | undefined;
    while ((c = remaining.shift())) await recoverTaskHistory(c);
  }));
}

export function recoverTaskHistory(c: Conv, strict = false) {
  const attempt = ++generation;
  attempts.set(c.id, attempt);
  deferred.add(c.id);
  return recover(c, attempt, strict);
}

/** A busy stream can keep changing during snapshots; its terminal event provides a quiet retry. */
export function retryDeferredRecovery(conversationId: unknown) {
  if (typeof conversationId !== 'string' || !deferred.has(conversationId)) return;
  deferred.delete(conversationId);
  const c = S.convs.find(item => item.remote && item.id === conversationId);
  if (c) void recoverTaskHistory(c);
}
