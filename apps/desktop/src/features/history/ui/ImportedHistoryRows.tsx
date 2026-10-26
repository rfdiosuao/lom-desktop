import { logoUrl } from '@/features/settings/runtime/agents';
import { continueHistory } from '../runtime/historyContinuation';
import { hideHistory, historyAgentId, historySourceAgent, shownImports } from '@/state/history';
import { IconBtn } from '@/shared/ui/Button';
import { toast, toastError } from '@/shared/overlays/controller';
import { HistoryIcon } from '@/shared/ui/HistoryIcon';
import { useStore } from '@/state/store';
import { beginHistoryDrag, historyTitle, sourceName } from '../runtime/historyImport';

export function ImportedHistoryRows() {
  const s = useStore();
  if (s.historyImportError) return <p className="muted" role="status">历史归档读取失败，请打开导入历史重试。</p>;
  return <>{shownImports(historyAgentId()).map(entry => <div key={entry.id} className="conv"
    draggable onDragStart={e => beginHistoryDrag(e.dataTransfer, entry)} title={historyTitle(entry)}>
    <button type="button" className="conv__name conv__name--desktop" onClick={() => void continueHistory(entry).catch(error => toastError('打开历史会话失败', error))}>
      <HistoryIcon src={logoUrl(historySourceAgent(entry.source)?.icon)} name={sourceName(entry.source)} /><span className="conv__title">{historyTitle(entry)}</span>
    </button>
    <IconBtn ic="close" label="移出列表" size="sm" onClick={() => { hideHistory(entry.id); toast('已移出列表，可在「归档的任务」里恢复', 'archive'); }} />
  </div>)}</>;
}
