import { personalError } from '../runtime/errors';
import { useEffect, useState } from 'react';
import { Btn } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { Markdown } from '@/shared/ui/Markdown';
import { confirm, toastError } from '@/shared/overlays/controller';
import { documentDrafts as drafts, DOCUMENTS, listDiary, readDocument, saveDocument } from '../runtime/memory';
import type { PersonalAssistant } from '../runtime/catalog';
import { useStore } from '@/state/store';

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
/** 日记文件名是本地日期 YYYY-MM-DD；按本地日历取星期，格式不对时不显示 */
const weekday = (date: string) => { const [y, m, d] = date.split('-').map(Number); const at = new Date(y, m - 1, d); return Number.isNaN(at.getTime()) ? null : WEEK[at.getDay()]; };

export function PersonalDocuments({ assistant }: { assistant: PersonalAssistant }) {
  const [opened, setOpened] = useState('');
  const [query, setQuery] = useState('');
  const [diaries, setDiaries] = useState<string[] | null>(null);
  const [diaryError, setDiaryError] = useState(''), [diaryRev, setDiaryRev] = useState(0);
  // UI-AUDIT-02 UI-13：这位助理的任务开始 / 结束后重新读取日记列表，也可手动刷新或失败后重试
  const s = useStore(), running = !!assistant.conversation && !!s.running[assistant.conversation];
  useEffect(() => {
    let live = true; setDiaryError('');
    void listDiary(assistant).then(v => { if (live) setDiaries(v); }, e => { if (live) setDiaryError(personalError(e)); });
    return () => { live = false; };
  }, [assistant.id, diaryRev, running]);
  const refresh = () => setDiaryRev(x => x + 1);
  // UI-AUDIT-03：日记行只显示日期和星期，不重复文件路径和相同的副标题
  const row = (name: string, label: string, sub?: string, file: string | null = name) => <div key={name}>
    <button className="pa-document" type="button" aria-expanded={opened === name} onClick={() => setOpened(opened === name ? '' : name)}>
      <Icon name="file" /><span><strong>{label}{file && <small>{file}</small>}</strong>{sub && <small>{sub}</small>}</span><Icon name={opened === name ? 'chevron' : 'chevronRight'} />
    </button>
    {opened === name && <DocumentEditor key={`${assistant.id}:${name}`} assistant={assistant} name={name} />}
  </div>;
  return <>
    <section className="pa-section"><h2>助理文档</h2>{DOCUMENTS.slice(0, 4).map(([name, label, sub]) => row(name, label, sub))}</section>
    <section className="pa-section"><h2>记忆与日记</h2>
      <label className="pa-search"><Icon name="search" /><input aria-label="筛选记忆文档" placeholder="筛选记忆与日记" value={query} onChange={e => setQuery(e.target.value)} /></label>
      {DOCUMENTS.slice(4).filter(x => x.join(' ').toLowerCase().includes(query.toLowerCase())).map(([name, label, sub]) => row(name, label, sub))}
      <div className="pa-section__heading"><h3>每日日记</h3><Btn label="刷新" variant="link" size="sm" onClick={refresh} /></div>
      {diaryError ? <p className="pa-error" role="alert">读取日记失败：{diaryError}<Btn label="重试" size="sm" onClick={refresh} /></p> : diaries === null ? <p className="pa-muted">正在读取…</p> : !diaries.length ? <p className="pa-muted">还没有日记。自动日记尚未接入。</p> : diaries.filter(name => name.includes(query)).map(name => row(name, name.slice(7, -3), undefined, weekday(name.slice(7, -3))))}
    </section>
  </>;
}


function DocumentEditor({ assistant, name }: { assistant: PersonalAssistant; name: string }) {
  const draftKey = `${assistant.directory}/${name}`;
  const cached = drafts.get(draftKey);
  const [base, setBase] = useState<string | null>(null), [value, setValue] = useState(cached?.value || '');
  const [error, setError] = useState(''), [saving, setSaving] = useState(false), [editing, setEditing] = useState(!!cached);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true; setBase(null); setError('');
    void readDocument(assistant, name).then(text => { if (live) { const saved = drafts.get(draftKey); setBase(saved?.base ?? text); setValue(saved?.value ?? text); if (saved && saved.base !== text) setError('磁盘内容已更新，你的未保存草稿仍保留，请核对后重新读取。'); } }, e => { if (live) setError(personalError(e)); });
    return () => { live = false; };
  }, [assistant.id, name, revision]);
  useEffect(() => {
    if (base === null || value === base) return;
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [base, value]);
  const save = async () => {
    if (base === null) return;
    setSaving(true); setError('');
    try { await saveDocument(assistant, name, base, value); setBase(value); drafts.delete(draftKey); setEditing(false); }
    catch (e) { setError(personalError(e)); toastError('文档保存失败', new Error(personalError(e))); }
    finally { setSaving(false); }
  };
  // UI-AUDIT-02 UI-12：取消编辑；有草稿时明确选择放弃还是继续编辑，不静默丢失也不误保存
  const stopEditing = () => { drafts.delete(draftKey); if (base !== null) setValue(base); setEditing(false); };
  const cancel = () => {
    if (base !== null && value !== base) confirm({ title: '放弃未保存的修改？', desc: '磁盘上的文档不会改变。要保留修改，请继续编辑后保存。', okText: '放弃修改', cancelText: '继续编辑', danger: true, onOk: stopEditing });
    else stopEditing();
  };
  const reload = () => {
    if (base !== null && value !== base) confirm({ title: '重新读取文档？', desc: '当前尚未保存的修改会被丢弃。', okText: '重新读取', onOk: () => { drafts.delete(draftKey); setRevision(x => x + 1); } });
    else setRevision(x => x + 1);
  };
  return <div className="pa-editor">
    {error && <p role="alert" className="pa-error">{error}</p>}
    {base === null ? <p className="pa-muted">{error ? '读取未完成' : '正在读取文档…'}</p> : editing ? <textarea disabled={saving} aria-label={`编辑${name}`} value={value} onChange={e => { setValue(e.target.value); drafts.set(draftKey, { base: base || '', value: e.target.value }); }} /> : <Markdown text={value} />}
    <div className="pa-editor__actions"><Btn label="重新读取" size="sm" onClick={reload} disabled={saving} />{base !== null && (editing ? <><Btn label="取消" size="sm" disabled={saving} onClick={cancel} /><Btn label={saving ? '保存中…' : '保存'} size="sm" variant="primary" disabled={saving || value === base} onClick={() => void save()} /></> : <Btn label="编辑" size="sm" onClick={() => setEditing(true)} />)}</div>
    {editing && value !== base && <small>有未保存的修改，切换后草稿会在本窗口内保留。</small>}
  </div>;
}
