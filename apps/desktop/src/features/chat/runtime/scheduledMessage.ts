import { api } from '@/core/client';
import { S, update } from '@/state/store';
import type { Conv, Msg } from '@/state/types';
import type { CoreMessage } from '@/core/types';

/** Core cron prompt wrappers: aionui-cron/src/prompt.rs. Only hidden right-hand text is projected. */
export function scheduledMessage(it: CoreMessage): Msg | null {
  if (!it.hidden || it.type !== 'text' || it.position !== 'right' || typeof it.content?.content !== 'string') return null;
  const raw = it.content.content;
  let body: string;
  if (raw.startsWith('[Scheduled Task Execution]\nTask: ')) {
    const marker = '\n\nTask instruction:\n';
    const start = raw.indexOf(marker);
    if (start < 0) return null;
    body = raw.slice(start + marker.length);
  } else if (raw.startsWith('[Scheduled Task Context]\nTask: ')) {
    const marker = '[/Scheduled Task Context]\n\n';
    const start = raw.indexOf(marker);
    if (start < 0) return null;
    body = raw.slice(start + marker.length);
    // Only the variant requesting a skill suggestion appends this internal suffix.
    if (raw.slice(0, start).includes('at the end).')) {
      const suffix = body.lastIndexOf('\n\n---\n\n[Post-Task]');
      if (suffix >= 0) body = body.slice(0, suffix);
    }
  } else return null;
  if (!body.trim()) return null;
  return { id: it.id, remoteId: it.msg_id, type: 'user', at: it.created_at, text: body, source: 'schedule' };
}

/** A cron artifact is emitted after the hidden instruction is persisted, before execution starts.
 * Merge just these instructions; replacing the history here could discard an in-flight reply. */
export async function syncScheduledMessages(conv: Conv) {
  const account = S.account?.id;
  const res = await api<{ items: CoreMessage[] }>('GET', `/api/conversations/${conv.id}/messages?limit=500`);
  if (S.account?.id !== account || !S.convs.includes(conv)) return;
  const incoming = res.items.map(scheduledMessage).filter((m): m is Msg => !!m);
  update(() => {
    for (const m of incoming) {
      if (conv.messages.some(x => x.id === m.id || (!!m.remoteId && x.remoteId === m.remoteId))) continue;
      const i = conv.messages.findIndex(x => x.at > m.at || (x.at === m.at && x.type !== 'user'));
      conv.messages.splice(i < 0 ? conv.messages.length : i, 0, m);
    }
  });
}
