import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/shared/ui/Overlay';
import { Btn } from '@/shared/ui/Button';
import { closeModal, guardClose } from '@/shared/overlays/controller';
import { continueHistory } from '../runtime/historyContinuation';
import { historyNotice, historyTitle, importHistory, listHistory, refreshHistory, scanHistory, sourceName, type HistoryEntry, type HistorySource } from '../runtime/historyImport';
import { friendlyError } from '@/shared/lib/friendlyError';

export function HistoryImportModal() {
  const [sources, setSources] = useState<HistorySource[]>(['codex', 'claude']);
  const [entries, setEntries] = useState<HistoryEntry[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [archived, setArchived] = useState<HistoryEntry[]>([]), [query, setQuery] = useState('');
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [report, setReport] = useState('');
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const active = useRef(true), locked = useRef(false);
  useEffect(() => {
    active.current = true; guardClose('historyImport', () => !locked.current);
    void listHistory().then(data => { if (active.current) setArchived(data.entries); }, e => { if (active.current) setError(String(e)); });
    return () => { active.current = false; guardClose('historyImport', null); };
  }, []);
  const run = async (label: string, fn: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(label); setError('');
    try { await fn(); } catch (e) { if (active.current) setError(friendlyError(e)); }
    finally { locked.current = false; if (active.current) setBusy(''); }
  };
  const scan = () => run('正在查找会话…', async () => {
    const data = await scanHistory(sources);
    if (!active.current) return;
    setEntries(data.entries); setSelected(data.entries.map(e => e.id)); setDiagnostics(data.diagnostics);
  });
  const commit = () => run('正在导入…', async () => {
    const result = await importHistory(entries.filter(e => selected.includes(e.id)));
    const data = await refreshHistory();
    if (!active.current) return;
    setReport(`已导入 ${result.imported} 个，已存在 ${result.skipped} 个，失败 ${result.errors.length} 个`);
    setDiagnostics(result.errors); setArchived(data.entries); setEntries([]);
  });
  const title = historyTitle;
  const visible = archived.filter(e => sources.includes(e.source) && title(e).toLowerCase().includes(query.toLowerCase()));
  return <Modal title="导入会话历史" size="lg" desc="导入后归入对应的 Agent，点击会话标题继续对话，也可拖到其他聊天框作为引用。" foot={<Btn label="关闭" disabled={!!busy} onClick={closeModal} />}>
    <div className="history-import">
      <div className="history-import__actions">
        {(['codex', 'claude'] as const).map(source => <label key={source}><input type="checkbox" checked={sources.includes(source)} disabled={!!busy} onChange={e => setSources(v => e.target.checked ? [...v, source] : v.filter(s => s !== source))} /> {sourceName(source)}</label>)}
        <Btn label="查找本机会话" disabled={!!busy || !sources.length} onClick={() => void scan()} />
      </div>
      {busy && <p role="status">{busy}</p>}{report && <p role="status">{report}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {diagnostics.length > 0 && <details><summary>导入提示（{diagnostics.length}）</summary><p>{diagnostics.map(historyNotice).join('；')}</p></details>}
      {entries.length > 0 && <>
        <div className="history-import__actions"><Btn label={selected.length === entries.length ? '取消全选' : '全选'} disabled={!!busy} onClick={() => setSelected(selected.length === entries.length ? [] : entries.map(e => e.id))} />
          <Btn label={`导入 ${selected.length} 个会话`} variant="primary" disabled={!!busy || !selected.length} onClick={() => void commit()} /></div>
        <div className="history-import__list">{entries.map(e => <label className="history-import__row" key={e.id}>
          <input type="checkbox" checked={selected.includes(e.id)} disabled={!!busy} onChange={event => setSelected(v => event.target.checked ? [...v, e.id] : v.filter(id => id !== e.id))} /><b>{title(e)}</b>
        </label>)}</div>
      </>}
      <h3>已导入会话（{visible.length}）</h3>
      <input aria-label="搜索会话标题" className="input" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索会话标题" />
      <div className="history-import__list">{visible.map(e => <div key={e.id} className="history-import__row">
        <b className="grow">{title(e)}</b><Btn label="继续对话" size="sm" disabled={!!busy} onClick={() => void run('正在打开会话…', () => continueHistory(e))} />
      </div>)}</div>
      {!archived.length && !busy && <p className="muted">尚未导入会话。</p>}
    </div>
  </Modal>;
}
