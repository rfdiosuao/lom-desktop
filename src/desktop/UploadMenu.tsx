import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Btn } from './Button';
import './uploadMenu.css';

export interface UploadSkill { id: string; name: string; source: string; location: string; }
export interface UploadMenuProps {
  loadSkills: () => Promise<{ skills: UploadSkill[]; warnings: string[] }>;
  prepareDraft: (skill: UploadSkill, choice: 'append' | 'replace') => Promise<void>;
  onManual: () => void;
  hasDraft: boolean;
  /** Change when the data owner/workspace changes to discard in-flight reads. */
  scopeKey: string;
}
export function UploadMenu({ loadSkills, prepareDraft, onManual, hasDraft, scopeKey }: UploadMenuProps) {
  const [open, setOpen] = useState(false), [sub, setSub] = useState(false), [query, setQuery] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [rows, setRows] = useState<UploadSkill[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<UploadSkill>(), [busy, setBusy] = useState(false), [flip, setFlip] = useState(false);
  const root = useRef<HTMLDivElement>(null), submenu = useRef<HTMLDivElement>(null);
  useEffect(() => { setOpen(false); setSub(false); setRows([]); setSelected(undefined); setError(''); }, [scopeKey]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node) && !busy) setOpen(false); };
    const layout = () => setFlip((root.current?.getBoundingClientRect().right || 0) + 360 > window.innerWidth);
    layout(); document.addEventListener('pointerdown', outside); window.addEventListener('resize', layout);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', layout); };
  }, [open, busy]);
  useEffect(() => {
    if (!sub || !open) return;
    let active = true; setLoading(true); setError(''); setRows([]); setWarnings([]);
    void loadSkills().then(r => { if (active) { setRows(r.skills); setWarnings(r.warnings); } }, e => { if (active) setError(String(e.message || e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sub, open, scopeKey, loadSkills]);
  const enter = async (row: UploadSkill, choice: 'append' | 'replace') => {
    setBusy(true); setError('');
    try { await prepareDraft(row, choice); setOpen(false); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const choose = (row: UploadSkill) => {
    if (hasDraft) setSelected(row);
    else void enter(row, 'replace');
  };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); if (selected) setSelected(undefined); else if (sub) setSub(false); else setOpen(false); root.current?.querySelector<HTMLButtonElement>('button')?.focus(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setSub(true); requestAnimationFrame(() => submenu.current?.querySelector<HTMLInputElement>('input')?.focus()); }
    if (e.key === 'ArrowLeft' && sub) { e.preventDefault(); setSub(false); root.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"][role="menuitem"]')?.focus(); }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || e.target instanceof HTMLInputElement) return;
    const scope = submenu.current?.contains(e.target as Node) ? submenu.current : root.current;
    const buttons = [...(scope?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || [])];
    if (!buttons.length) return;
    e.preventDefault(); const i = buttons.indexOf(e.target as HTMLButtonElement);
    buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  };
  const filtered = rows.filter(r => `${r.name} ${r.location}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="skill-upload" ref={root} onKeyDown={keys}>
    <Btn label="上传技能" icRight="chevron" variant="primary" disabled={busy} aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(!open); setSelected(undefined); }} />
    {open && <div className="skill-upload__menu" role="menu" aria-label="上传技能">
      <button className="btn btn--ghost" disabled={busy} role="menuitem" aria-haspopup="menu" aria-expanded={sub} onMouseEnter={() => setSub(true)} onClick={() => setSub(true)}>让 Lom 上传 ›</button>
      <button className="btn btn--ghost" disabled={busy} role="menuitem" onClick={() => { setOpen(false); onManual(); }}>手动上传</button>
      {sub && <div className={`skill-upload__skills ${flip ? 'is-left' : ''}`} ref={submenu} role="menu" aria-label="本机技能">
        <input className="input" aria-label="搜索本机技能" placeholder="搜索技能名称或路径" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); submenu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus(); } }} />
        {warnings.length > 0 && <details><summary>部分目录不可用（{warnings.length}）</summary>{warnings.map(w => <p key={w}>{w}</p>)}</details>}
        {error && <p role="alert">{error}</p>}{(loading || busy) && <p role="status">{busy ? '正在准备 Lom 草稿…' : '正在读取本机技能…'}</p>}
        {selected ? <div><p>新任务页已有草稿。追加或替换到新的 Lom 上传会话？原草稿仍保留在新任务页。</p>
          <Btn label="追加" disabled={busy} onClick={() => void enter(selected, 'append')} /><Btn label="替换" disabled={busy} onClick={() => void enter(selected, 'replace')} /><Btn label="取消" disabled={busy} onClick={() => setSelected(undefined)} /></div> :
          <div className="skill-upload__list">{!loading && !error && !filtered.length && <p>没有匹配的可访问技能。请先安装技能或检查目录权限。</p>}
            {filtered.map(row => <button className="btn btn--ghost skill-upload__item" role="menuitem" key={row.location} disabled={busy} onClick={() => choose(row)}><b>{row.name}</b><small>{row.source} · {row.location}</small></button>)}</div>}
      </div>}
    </div>}
  </div>;
}
