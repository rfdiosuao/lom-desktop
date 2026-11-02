import { useEffect, useRef, useState } from 'react';
import { closeModal, confirm, guardClose, toast, toastError } from '@/shared/overlays/controller';
import { openConv } from '@/app/navigation';
import { Btn } from '@/shared/ui/Button';
import { Empty } from '@/shared/ui/Layout';
import { Modal } from '@/shared/ui/Overlay';
import { listArchived, restoreTask } from '../runtime/commands';
import { addMemory, listMemory, memoryDir, readMemory, writeMemory, type MemoryFile } from '@/features/settings/runtime/lomMemory';
import type { Conv } from '@/state/types';
import { ago } from '@/shared/lib/util';
import { unhideHistory } from '@/state/history';
import { useStore } from '@/state/store';
import { historyTitle, sourceName } from '@/features/history/runtime/historyImport';
import { friendlyError } from '@/shared/lib/friendlyError';

/* ===== 归档的任务：列表、恢复 ===== */
export function ArchivedModal() {
  const s = useStore();
  const [list, setList] = useState<Conv[] | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
  // D34：移出列表的导入历史（不含已归档任务对应的那条——它随任务一起恢复）
  const hidden = s.historyImports.filter(e => s.historyHidden.includes(e.id) && !(list || []).some(c => c.historyArchiveId === e.id));
  useEffect(() => { listArchived().then(setList, e => setError(friendlyError(e))); }, []);
  const restore = async (c: Conv) => {
    setBusy(c.id);
    try { await restoreTask(c.id); setList(l => l?.filter(x => x.id !== c.id) ?? null); toast(`已恢复「${c.title}」`, 'check'); }
    catch (e) { toastError('恢复失败', e); } finally { setBusy(''); }
  };
  return (
    <Modal title="归档的任务" desc="归档的任务不在左侧列表里显示，内容都还在；恢复后回到「最近任务」。" size="lg" foot={<Btn label="关闭" variant="primary" onClick={closeModal} />}>
      {error ? <p className="form-error">读取失败：{error}</p>
        : !list ? <p className="muted">正在读取…</p>
        : !list.length && !hidden.length ? <Empty ic="archive" title="没有归档的任务" desc="在任务的「…」菜单或输入框里输入 / 选「归档」。" />
        : <div className="list">{list.map(c => (
          <div key={c.id} className="list-row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="grow" style={{ minWidth: 0 }}><b>{c.title}</b><div className="muted" style={{ fontSize: 13 }}>{c.agentName ? `${c.agentName} · ` : ''}{ago(c.updated)}</div></div>
            <Btn label={busy === c.id ? '正在恢复…' : '恢复'} variant="secondary" size="sm" disabled={!!busy} onClick={() => void restore(c)} />
            <Btn label="恢复并打开" size="sm" disabled={!!busy} onClick={() => void restoreTask(c.id).then(() => { closeModal(); openConv(c.id); }, e => toastError('恢复失败', e))} />
          </div>))}
          {hidden.map(e => (
            <div key={e.id} className="list-row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="grow" style={{ minWidth: 0 }}><b>{historyTitle(e)}</b><div className="muted" style={{ fontSize: 13 }}>{sourceName(e.source)} 历史 · 已移出列表</div></div>
              <Btn label="恢复" variant="secondary" size="sm" onClick={() => { unhideHistory(e.id); toast(`已恢复「${historyTitle(e)}」`, 'check'); }} />
            </div>))}</div>}
    </Modal>
  );
}

/* ===== Lom 的记忆（这个工作文件夹）：看、改、加 ===== */
export function LomMemoryModal({ p }: { p: Record<string, unknown> }) {
  const workspace = String(p.workspace || '');
  const dir = memoryDir(workspace);
  const [files, setFiles] = useState<MemoryFile[] | null>(null);
  const [open, setOpen] = useState<MemoryFile | null>(null), [text, setText] = useState(''), [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState(false), [title, setTitle] = useState(''), [body, setBody] = useState(''), [busy, setBusy] = useState(false);
  const request = useRef(0);
  const drafts = useRef<Record<string, string>>({});
  const [listError, setListError] = useState('');
  const [loading, setLoading] = useState(false), [readError, setReadError] = useState('');
  useEffect(() => () => { request.current++; }, [dir]);
  // 有没保存的修改：关闭前先问一句（底部「关闭」、右上角 ×、Esc 都会经过这里）
  const unsaved = useRef(false);
  unsaved.current = Object.keys(drafts.current).length > 0 || (adding && !!(title.trim() || body.trim()));
  useEffect(() => {
    guardClose('lomMemory', () => {
      if (!unsaved.current) return true;
      confirm({ title: '有没保存的修改', desc: '关闭后，没保存的记忆修改和新增内容会丢失。', okText: '放弃并关闭', danger: true, onOk: () => closeModal(true) });
      return false;
    });
    return () => guardClose('lomMemory', null);
  }, []);
  const refresh = () => {
    if (!dir) return;
    setListError(''); setFiles(null);
    void listMemory(dir, workspace).then(setFiles, e => { setFiles([]); setListError(friendlyError(e)); });
  };
  useEffect(refresh, [dir]);
  const pick = async (f: MemoryFile) => {
    if (!dir) return;
    const version = ++request.current;
    setAdding(false); setOpen(f); setReadError('');
    if (f.path in drafts.current) { setText(drafts.current[f.path]); setDirty(true); setLoading(false); return; }
    setDirty(false); setText(''); setLoading(true);
    try { const data = await readMemory(f.path, dir); if (version === request.current) setText(data); }
    catch (e) { if (version === request.current) setReadError(`读取失败：${friendlyError(e)}`); }
    finally { if (version === request.current) setLoading(false); }
  };
  const save = async () => {
    if (!dir || !open || loading || readError || busy || !dirty) return; setBusy(true);
    try { await writeMemory(open.path, text, dir); delete drafts.current[open.path]; setDirty(false); toast('记忆已保存，Lom 下次开任务就会用到', 'check'); }
    catch (e) { toastError('保存失败', e); } finally { setBusy(false); }
  };
  const add = async () => {
    if (!dir || !title.trim() || !body.trim()) return; setBusy(true);
    try { await addMemory(dir, title.trim(), body, workspace); setAdding(false); setTitle(''); setBody(''); refresh(); toast('已加入记忆', 'check'); }
    catch (e) { toastError('添加失败', e); } finally { setBusy(false); }
  };
  if (!dir) return <Modal title="Lom 的记忆" desc="这个任务没有工作文件夹（或路径太长），找不到对应的记忆。" foot={<Btn label="关闭" onClick={closeModal} />} />;
  return (
    <Modal title="Lom 的记忆" desc={`工作文件夹「${workspace}」的记忆。Lom 在这个文件夹里干活时会自己记、自己读；你也可以在这里改。`} size="xl"
      foot={<><Btn label="新增一条" ic="plus" variant="secondary" disabled={busy} onClick={() => { request.current++; setLoading(false); setAdding(true); setOpen(null); }} /><span className="grow" />{open && <Btn label={busy ? '保存中…' : '保存'} variant="primary" disabled={!dirty || busy || loading || !!readError} onClick={() => void save()} />}<Btn label="关闭" variant="secondary" onClick={closeModal} /></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0,1fr)', gap: 16, minHeight: 320 }}>
        <div className="list" style={{ alignSelf: 'start' }}>
          {listError ? <div role="alert"><p className="form-error">读取失败：{listError}</p><Btn label="重试" onClick={refresh} /></div> : files === null ? <p className="muted">正在读取…</p> : !files.length ? <p className="muted" style={{ fontSize: 13 }}>还没有记忆。Lom 会在对话里记下你的偏好和重要信息，也可以点「新增一条」。</p>
            : files.map(f => <button key={f.path} type="button" className={`list-row${open?.path === f.path ? ' is-active' : ''}`} disabled={busy} style={{ textAlign: 'left', width: '100%' }} onClick={() => void pick(f)}>{f.name === 'MEMORY.md' ? '索引 MEMORY.md' : f.name}</button>)}
        </div>
        {adding ? <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          {/* 保存期间锁住输入：提交的就是看到的，成功后清空不会丢掉后来打的字 */}
          <input className="input" placeholder="标题，例如：发布时间偏好" value={title} disabled={busy} onChange={e => setTitle(e.target.value)} />
          <textarea className="input" rows={8} placeholder="内容，例如：小红书笔记固定晚上 8 点发布。" value={body} disabled={busy} onChange={e => setBody(e.target.value)} />
          <div className="row" style={{ gap: 8 }}><Btn label={busy ? '正在加入…' : '加入记忆'} variant="primary" disabled={busy || !title.trim() || !body.trim()} onClick={() => void add()} /><Btn label="取消" variant="ghost" disabled={busy} onClick={() => setAdding(false)} /></div>
        </div>
          : open ? <div className="memory-editor"><p className="muted" role="status">{loading ? '正在读取…' : readError}</p><textarea disabled={busy || loading || !!readError} className="input" style={{ minHeight: 320, fontFamily: 'var(--mono)', fontSize: 13 }} value={text} onChange={e => { drafts.current[open.path] = e.target.value; setText(e.target.value); setDirty(true); }} aria-label={`编辑 ${open.name}`} /></div>
          : <p className="muted">选左边的一条查看或修改。</p>}
      </div>
    </Modal>
  );
}
