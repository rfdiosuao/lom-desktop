import type { DraftAttachment } from '@/state/types';

/** One reference card may carry both its original archive and later continuation messages. */
export function expandContextFiles(attachments: DraftAttachment[]): DraftAttachment[] {
  return attachments.flatMap(a => [a, ...(a.historyPaths || []).map(path => ({
    name: `${a.name} · 原始会话`, path, kind: 'local' as const,
  }))]);
}
