import { useEffect, useState, type RefObject } from 'react';
import { closeMenu, getMenuAnchor } from '@/shared/overlays/controller';
import type { MenuItem } from '@/shared/ui/Overlay';
import type { MenuState } from '@/state/types';
export function useSlashKeys(ref: RefObject<HTMLDivElement | null>, menu: MenuState | null, items: MenuItem[], slash: boolean) {
  const [focused, setFocused] = useState(0);
  useEffect(() => { setFocused(0); }, [menu?.key, menu?.ctx.query]);
  useEffect(() => {
    if (!slash) return;
    const keys = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!ref.current?.contains(e.target as Node) && !getMenuAnchor()?.contains(e.target as Node)) return;
      const enabled = items.map((it, i) => it !== '-' && !it.header && !it.disabled ? i : -1).filter(i => i >= 0);
      const selected = enabled.includes(focused) ? focused : enabled[0];
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeMenu(); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        const it = items[selected];
        if (it && it !== '-' && !it.header && !it.disabled) { if (!it.keepOpen) closeMenu(); it.onSelect(); }
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const pos = enabled.indexOf(selected), step = e.key === 'ArrowDown' ? 1 : -1;
        const next = enabled[(pos + step + enabled.length) % enabled.length];
        if (next !== undefined) { setFocused(next); ref.current?.querySelector(`[data-menu-index="${next}"]`)?.scrollIntoView?.({block:'nearest'}); }
      }
    };
    document.addEventListener('keydown', keys);
    return () => document.removeEventListener('keydown', keys);
  }, [slash, items, focused]);

  return focused;
}
