import type { HTMLAttributes } from 'react';

export interface CardNavigation { open: () => void; label: string; }

/** Whole-card navigation excludes nested controls and text selection. */
export function cardNavigation(navigation?: CardNavigation): HTMLAttributes<HTMLElement> {
  if (!navigation) return {};
  return {
    role: 'link', tabIndex: 0, 'aria-label': navigation.label,
    onClick: e => {
      if (e.defaultPrevented || e.button !== 0 || (e.target as Element).closest('button,a,input,select,textarea,[role="button"]')) return;
      if (window.getSelection()?.toString()) return;
      navigation.open();
    },
    onKeyDown: e => {
      if (e.target !== e.currentTarget || e.key !== 'Enter' || e.repeat) return;
      e.preventDefault(); navigation.open();
    },
  };
}
