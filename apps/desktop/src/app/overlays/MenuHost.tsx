import { t } from '@/shared/i18n/index';
import { useSlashKeys } from '@/features/chat/slash/useSlashKeys';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { closeMenu, getMenuAnchor } from '@/shared/overlays/controller';
import { MenuItemView } from '@/shared/ui/Overlay';
import { useStore } from '@/state/store';
import { MENUS } from './menu-registry';

/* ===== 下拉菜单宿主：同一时间只有一个菜单；位置贴着触发元素，超出视口时翻转 ===== */

export function MenuHost() {
  const s = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const menu = s.menu;
  const slash = menu?.id === 'mention' && menu.ctx.kind === 'slash';
  const items = menu ? MENUS[menu.id]?.(menu.ctx) || [] : [];
  const focused = useSlashKeys(ref, menu, items, !!slash);

  useLayoutEffect(() => {
    const m = ref.current;
    if (!m || !menu) return;
    const r = menu.rect, vw = window.innerWidth, vh = window.innerHeight;
    m.style.width = menu.ctx.matchWidth ? `${r.width}px` : '';
    const mw = m.offsetWidth, mh = m.offsetHeight;
    let left = menu.ctx.align === 'end' ? r.right - mw : r.left;
    left = Math.max(8, Math.min(left, vw - mw - 8));
    let top = r.bottom + 6;
    if (top + mh > vh - 8) top = Math.max(8, r.top - mh - 6);
    m.style.left = `${left}px`;
    m.style.top = `${top}px`;
  });

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || getMenuAnchor()?.contains(t)) return;
      closeMenu();
    };
    const onResize = () => closeMenu();
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onResize);
    return () => { document.removeEventListener('pointerdown', onDown, true); window.removeEventListener('resize', onResize); };
  }, [menu]);

  if (!menu) return null;
  const build = MENUS[menu.id];
  if (!build) { console.warn('未登记的菜单', menu.id); return null; }
  const first = items.findIndex(it => it !== '-' && !it.header && !it.disabled);
  const active = items[focused] && items[focused] !== '-' && !items[focused].header && !items[focused].disabled ? focused : first;
  return (
    <div className={`menu${menu.id === 'attach' ? ' menu--add' : slash ? ' menu--commands' : ''}`} role="menu" ref={ref}>
      {items.map((it, i) => {
        if (it === '-') return <div key={i} className="menu__sep" />;
        if (it.header) return <div key={i} className="menu__label">{t(it.label)}</div>;
        return <MenuItemView key={i} index={i} focused={slash && i === active} it={it} onPick={() => { if (!it.keepOpen) closeMenu(); it.onSelect(); }} />;
      })}
    </div>
  );
}
