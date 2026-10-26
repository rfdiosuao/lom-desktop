import { personalError } from '../runtime/errors';
import { useEffect, useState } from 'react';
import { Btn } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { Markdown } from '@/shared/ui/Markdown';
import { confirm, toastError } from '@/shared/overlays/controller';
import { documentDrafts as drafts, DOCUMENTS, listDiary, readDocument, saveDocument } from '../runtime/memory';
import type { PersonalAssistant } from '../runtime/catalog';

export function PersonalDocuments({ assistant }: { assistant: PersonalAssistant }) {
  const [opened, setOpened] = useState('');
  const [query, setQuery] = useState('');
  const [diaries, setDiaries] = useState<string[] | null>(null);
  const [diaryError, setDiaryError] = useState('');
  useEffect(() => {
    let live = true;
    void listDiary(assistant).then(v => { if (live) setDiaries(v); }, e => { if (live) setDiaryError(personalError(e)); });
    return () => { live = false; };
  }, [assistant.id]);
  const row = (name: string, label: string, sub: string) => <div key={name}>
    <button className="pa-document" type="button" aria-expanded={opened === name} onClick={() => setOpened(opened === name ? '' : name)}>
      <Icon name="file" /><span><strong>{label} <small>{name}</small></strong><small>{sub}</small></span><Icon name={opened === name ? 'chevron' : 'chevronRight'} />
    </button>
    {opened === name && <DocumentEditor key={`${assistant.id}:${name}`} assistant={assistant} name={name} />}
  </div>;
  return <>
    <section className="pa-section"><h2>助理文档</h2>{DOCUMENTS.slice(0, 4).map(([name, label, sub]) => row(name, label, sub))}</section>
    <section className="pa-section"><h2>记忆与日记</h2>
      <label className="pa-search"><Icon name="search" /><input aria-label="筛选记忆文档" placeholder="筛选记忆与日记" value={query} onChange={e => setQuery(e.target.value)} /></label>
      {DOCUMENTS.slice(4).filter(x => x.join(' ').toLowerCase().includes(query.toLowerCase())).map(([name, label, sub]) => row(name, label, sub))}
      <h3>每日日记</h3>
      {diaryError ? <p className="pa-error" role="alert">读取日记失败：{diaryError}</p> : diaries === null ? <p className="pa-muted">正在读取…</p> : !diaries.length ? <p className="pa-muted">还没有日记。自动日记尚未接入。</p> : diaries.filter(name => name.includes(query)).map(name => row(name, name.slice(7, -3), '查看当日记录'))}
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
  const reload = () => {
    if (base !== null && value !== base) confirm({ title: '重新读取文档？', desc: '当前尚未保存的修改会被丢弃。', okText: '重新读取', onOk: () => { drafts.delete(draftKey); setRevision(x => x + 1); } });
    else setRevision(x => x + 1);
  };
  return <div className="pa-editor">
    {error && <p role="alert" className="pa-error">{error}</p>}
    {base === null ? <p className="pa-muted">{error ? '读取未完成' : '正在读取文档…'}</p> : editing ? <textarea disabled={saving} aria-label={`编辑${name}`} value={value} onChange={e => { setValue(e.target.value); drafts.set(draftKey, { base: base || '', value: e.target.value }); }} /> : <Markdown text={value} />}
    <div className="pa-editor__actions"><Btn label="重新读取" size="sm" onClick={reload} disabled={saving} />{base !== null && (editing ? <Btn label={saving ? '保存中…' : '保存'} size="sm" variant="primary" disabled={saving} onClick={() => void save()} /> : <Btn label="编辑" size="sm" onClick={() => setEditing(true)} />)}</div>
    {editing && value !== base && <small>有未保存的修改，切换后草稿会在本窗口内保留。</small>}
  </div>;
}
