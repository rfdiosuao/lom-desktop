import { api, getEndpoint } from '@/core/client';
import type { CoreConversation, HistoryBundle, HistoryEntry } from '@/core/types';
import { authAccount } from '@/features/account/runtime/authScope';
import { agentTaskExtra } from '@/features/settings/runtime/agentWarmup';
import { usable } from '@/features/settings/runtime/agents';
import { convFromCore } from '@/features/chat/runtime/history';
import { historySourceAgent } from '@/state/history';
import { S, update } from '@/state/store';
import { closeModal, guardClose } from '@/shared/overlays/controller';
import { openConv } from '@/app/navigation';

function closeImport() { if (S.modals.at(-1)?.id === 'historyImport') { guardClose('historyImport', null); closeModal(); } }
const pending = new Map<string, Promise<void>>();
/** Open a real conversation in the original Agent, backed by immutable imported context. */
export function continueHistory(entry: HistoryEntry): Promise<void> {
  const existing = S.convs.find(c => c.historyArchiveId === entry.id);
  if (existing) { closeImport(); openConv(existing.id); return Promise.resolve(); }
  const active = pending.get(entry.id);
  if (active) return active;
  const task = create(entry).finally(() => pending.delete(entry.id));
  pending.set(entry.id, task);
  return task;
}
async function create(entry: HistoryEntry) {
  const agent = historySourceAgent(entry.source);
  if (!usable(agent)) throw new Error('请先在设置中连接对应的 CLI，再打开这段历史');
  const current = authAccount(), account = S.account?.id, endpoint = getEndpoint();
  const stillCurrent = () => endpoint === getEndpoint() && S.account?.id === account && (!account || current());
  const view = JSON.stringify([S.route, S.activeConv, S.mode]);
  const bundle = await api<HistoryBundle>('POST', `/api/lom/history/${encodeURIComponent(entry.id)}/bundle`, {});
  if (!stillCurrent()) throw new Error('账号或核心已切换，请重新打开历史');
  const row = await api<CoreConversation>('POST', '/api/conversations', {
    type: 'acp', name: entry.title,
    extra: { ...agentTaskExtra(agent!, ''), lom_history_id: entry.id, lom_history_context: bundle.transcript_path, lom_history_raw: bundle.raw_path },
  });
  if (!stillCurrent()) throw new Error('账号或核心已切换，未打开旧账号的历史');
  const conversation = { ...convFromCore(row), loaded: true, messages: [], historyArchiveId: entry.id, historyContextPath: bundle.transcript_path, historyRawPath: bundle.raw_path };
  update(s => {
    s.convs.unshift(conversation);
    s.historyAgentPick = agent!.id;
    s.attachments[`conv:${row.id}`] = [{ name: entry.title, historyId: entry.id, historyPaths: [bundle.raw_path], path: bundle.transcript_path, kind: 'local', ic: 'message' }];
  });
  if (view === JSON.stringify([S.route, S.activeConv, S.mode])) { closeImport(); openConv(row.id); }
}
