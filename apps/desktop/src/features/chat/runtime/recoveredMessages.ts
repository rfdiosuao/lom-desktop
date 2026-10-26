import type { Msg } from '@/state/types';

function sameMessage(saved: Msg, local: Msg) {
  if (saved.type !== local.type) return false;
  if (saved.id === local.id) return true;
  if (saved.remoteId && local.remoteId) return saved.remoteId === local.remoteId;
  if (saved.type === 'tool') return !!saved.callId && saved.callId === local.callId;
  if (saved.type === 'files') return JSON.stringify(saved.changes) === JSON.stringify(local.changes);
  if (saved.type === 'user') {
    return local.status !== 'unconfirmed' && !local.remoteId && saved.text === local.text &&
      JSON.stringify(saved.attachments?.map(a => a.name) || []) === JSON.stringify(local.attachments?.map(a => a.name) || []);
  }
  return saved.type === 'system' && saved.text === local.text;
}

/** Persisted text replaces incomplete chunks; unsaved input and local-only notices survive. */
export function recoveredMessages(saved: Msg[], local: Msg[], stillStreaming: boolean): Msg[] {
  const used = new Set<Msg>();
  const matches = new Map<Msg, Msg>();
  for (const message of local) {
    const match = saved.find(item => (!used.has(item) || (message.type === 'assistant' && !!message.remoteId)) && sameMessage(item, message));
    if (!match) continue;
    used.add(match);
    matches.set(message, match);
    if (message.type === 'user') {
      match.id = message.id;
      if (!message.remoteId) { match.remoteId = undefined; match.status = message.status; }
      if (message.attachments?.length) match.attachments = message.attachments;
    }
    const group = message.type === 'assistant' && message.remoteId
      ? local.filter(item => item.type === 'assistant' && item.remoteId === message.remoteId) : [message];
    if (stillStreaming && group.some(item => item.streaming)) {
      match.streaming = true;
      const text = group.map(item => item.text || '').join('');
      if (text && !match.text?.startsWith(text)) match.text = text;
    }
  }
  const merged = [...saved];
  for (const [index, message] of local.entries()) {
    if (matches.has(message)) continue;
    if (message.type === 'files' && filesCovered(local, index, matches)) continue;
    const next = local.slice(index + 1).map(item => matches.get(item)).find((item): item is Msg => !!item);
    const position = next ? merged.indexOf(next) : -1;
    merged.splice(position < 0 ? merged.length : position, 0, { ...message, streaming: stillStreaming && message.streaming });
  }
  return merged;
}

/** File summaries are derived from tool records; keep the refreshed totals for a recovered turn. */
function filesCovered(local: Msg[], index: number, matches: Map<Msg, Msg>) {
  const start = local.slice(0, index).findLastIndex(message => message.type === 'user');
  const offset = local.slice(index + 1).findIndex(message => message.type === 'user');
  const end = offset < 0 ? local.length : index + 1 + offset;
  const tools = local.slice(start + 1, end).filter(message => message.type === 'tool');
  return tools.length > 0 && tools.every(message => matches.has(message));
}
