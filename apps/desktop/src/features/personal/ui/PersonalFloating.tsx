import { useEffect, useRef, type PointerEvent } from 'react';
import { useStore, update } from '@/state/store';
import { Btn } from '@/shared/ui/Button';
import { closePersonalPanel, minimizePersonalPanel, openPersonalPanel, savePanelRect } from '../runtime/panel';
import { PersonalAgent } from './PersonalAgent';

/** One child panel of Lom; it never creates or controls an operating-system window. */
export function PersonalFloating() {
  const s = useStore(), panel = s.personalPanel, ref = useRef<HTMLDivElement>(null);
  const moving = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  useEffect(() => {
    if (panel && (s.cloud !== 'signed-in' || panel.account !== s.account?.id)) update(st => { st.personalPanel = null; });
  }, [s.cloud, s.account?.id, panel?.account]);
  useEffect(() => {
    const fit = () => { const r = ref.current?.getBoundingClientRect(); if (r) savePanelRect({ x: r.left, y: r.top, w: r.width, h: r.height }); };
    window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit);
  }, []);
  useEffect(() => { if (panel?.account === s.account?.id && !panel?.minimized) ref.current?.focus(); }, [panel?.account, panel?.minimized, s.account?.id]);
  if (!panel || panel.account !== s.account?.id || s.cloud !== 'signed-in') return null;
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = moving.current; if (!d) return;
    const r = ref.current!.getBoundingClientRect();
    savePanelRect({ x: d.left + e.clientX - d.x, y: d.top + e.clientY - d.y, w: r.width, h: r.height });
  };
  const finish = () => {
    moving.current = null; const r = ref.current?.getBoundingClientRect();
    if (r?.width && r.height) savePanelRect({ x: r.left, y: r.top, w: r.width, h: r.height });
  };
  return <>
    {panel.minimized && <div className="pa-restore"><Btn ic="sparkles" label="Personal Agent" onClick={openPersonalPanel} /></div>}
    <div ref={ref} className="pa-floating" role="dialog" tabIndex={-1} aria-label="Personal Agent" aria-modal="false" hidden={panel.minimized}
      style={panel.rect ? { left: panel.rect.x, top: panel.rect.y, width: panel.rect.w, height: panel.rect.h } : undefined}
      onPointerDownCapture={e => {
        if (e.button !== 0 || !(e.target as Element).closest('.pa-titlebar') || (e.target as Element).closest('button,input,textarea,select,a')) return;
        const r = ref.current!.getBoundingClientRect(); moving.current = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
        e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
      }} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}
      onKeyDown={e => { if (s.menu || s.modals.length) return; if (e.key === 'Escape') { e.stopPropagation(); closePersonalPanel(); } else if ((e.metaKey || e.ctrlKey) && ['n', 'b', ','].includes(e.key.toLowerCase())) { e.preventDefault(); e.stopPropagation(); } }}>
      <PersonalAgent onClose={closePersonalPanel} onMinimize={minimizePersonalPanel} />
    </div>
  </>;
}
