import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { loadReplyImage, saveReplyImage, copyReplyImage, type ImageContext, type ReplyImage as ImageData } from '@/features/chat/runtime/replyImages';

/* 对话里的图片：小图显示，左键点开看大图；右键（小图或大图上）像普通图片一样「复制图片 / 下载图片」 */
export function ReplyImage({ source, alt, context, ready = true }: { source: string; alt: string; context: ImageContext; ready?: boolean }) {
  const [data, setData] = useState<ImageData>();
  const [error, setError] = useState(''), [retry, setRetry] = useState(0), [notice, setNotice] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null), wasExpanded = useRef(false);
  const key = JSON.stringify(context);
  useEffect(() => {
    let active = true; setData(undefined); setError(''); setNotice(''); setExpanded(false);
    if (ready) void loadReplyImage(source, JSON.parse(key)).then(value => { if (active) setData(value); }, e => { if (active) setError(String(e instanceof Error ? e.message : e)); });
    return () => { active = false; };
  }, [source, key, ready, retry]);
  useEffect(() => {
    if (expanded) dialog.current?.showModal();
    else if (wasExpanded.current) opener.current?.focus();
    wasExpanded.current = expanded;
  }, [expanded]);
  useEffect(() => { // 菜单：点别处、按 Esc、滚动都关掉
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', onKey); window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', onKey); window.removeEventListener('scroll', close, true); };
  }, [menu]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 2500); return () => clearTimeout(t); }, [notice]);

  const copy = async () => {
    setMenu(null); if (!data) return;
    try { await copyReplyImage(data); setNotice('已复制图片'); }
    catch (e) { setNotice(`复制失败：${String(e instanceof Error ? e.message : e)}`); }
  };
  const save = async () => {
    setMenu(null); if (!data) return;
    try { if (await saveReplyImage(data)) setNotice('已保存'); }
    catch (e) { setNotice(`保存失败：${String(e instanceof Error ? e.message : e)}`); }
  };
  const openMenu = (e: MouseEvent) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); };
  // 菜单要画在大图对话框里面，否则会被对话框盖住
  const menuNode = menu && data ? (
    <div className="reply-image__menu" role="menu" style={{ left: Math.min(menu.x, innerWidth - 150), top: Math.min(menu.y, innerHeight - 90) }} onPointerDown={e => e.stopPropagation()}>
      <button type="button" role="menuitem" onClick={() => void copy()}>复制图片</button>
      <button type="button" role="menuitem" onClick={() => void save()}>下载图片</button>
    </div>
  ) : null;

  return <span className="reply-image">
    {data ? <button ref={opener} className="reply-image__open" type="button" aria-label={`查看大图：${alt || 'Agent 图片'}`} onClick={() => setExpanded(true)} onContextMenu={openMenu}>
      <img src={data.data} alt={alt || 'Agent 生成的图片'} loading="lazy" onError={() => { setData(undefined); setError('图片损坏，无法显示'); }} />
    </button>
      : <span className="reply-image__empty">{error || (ready ? '正在加载图片…' : '等待图片回复完成…')}{error && <button type="button" onClick={() => setRetry(x => x + 1)}>重试</button>}</span>}
    {(notice || data?.warning) && !expanded && <span className="reply-image__notice" role="status">{notice || data?.warning}</span>}
    {!expanded && menuNode && createPortal(menuNode, document.body)}
    {expanded && data && createPortal(<dialog ref={dialog} className="reply-image__dialog" aria-label={alt || '图片预览'} onCancel={() => setExpanded(false)} onClick={e => { if (e.target === e.currentTarget) setExpanded(false); }}>
      <button type="button" className="reply-image__close" autoFocus onClick={() => setExpanded(false)}>关闭</button>
      <img src={data.data} alt={alt || '图片预览'} onContextMenu={openMenu} />
      {notice && <span className="reply-image__notice" role="status">{notice}</span>}
      {menuNode}
    </dialog>, document.body)}
  </span>;
}
