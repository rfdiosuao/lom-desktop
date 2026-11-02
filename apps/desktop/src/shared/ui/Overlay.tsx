import { t } from '../i18n/index';
import type { ReactNode } from 'react';
import { closeModal } from '../overlays/controller';
import type { Agent } from '@/state/types';
import { cx } from '../lib/util';
import { Avatar, SelMark } from './Agent';
import { IconBtn } from './Button';
import { Icon } from './Icon';

/* ===== 弹层外壳：弹窗、菜单项 ===== */

/* 模态框外壳；title 为 null 时不显示标题栏（配对弹窗等自带大标题） */
export function Modal({ title, desc, children, foot, size, className, headExtra }: {
  title: string | null; desc?: string; children?: ReactNode; foot?: ReactNode; size?: 'sm' | 'lg' | 'xl' | 'full'; className?: string; headExtra?: ReactNode;
}) {
  return (
    <section className={cx('modal', size && `modal--${size}`, className)} role="dialog" aria-modal="true" aria-label={title || '对话框'}>
      {title !== null && (
        <header className="modal__head">
          <div className="modal__head-text">
            <h2 className="modal__title">{t(title)}</h2>
            {desc && <p className="modal__desc">{t(desc)}</p>}
          </div>
          {headExtra}
          <IconBtn ic="close" label="关闭" onClick={closeModal} className="modal__x" />
        </header>
      )}
      <div className="modal__body">{children}</div>
      {foot && <footer className="modal__foot">{foot}</footer>}
    </section>
  );
}

export type MenuItem =
  | '-'
  | { header: true; label: string }
  | {
      header?: false; label: string; desc?: string; ic?: string; avatar?: Agent; img?: string; hint?: string; leading?: ReactNode;
      onSelect: () => void; select?: 'multi' | 'single'; checked?: boolean; danger?: boolean;
      keepOpen?: boolean; disabled?: boolean; sub?: boolean;
    };

export function MenuItemView({ it, onPick, focused, index }: { it: Exclude<MenuItem, '-' | { header: true; label: string }>; onPick: () => void; focused?: boolean; index?: number }) {
  return (
    <button
      type="button"
      data-menu-index={index}
      title={t(it.desc)}
      role={it.select === 'multi' ? 'menuitemcheckbox' : it.select === 'single' ? 'menuitemradio' : 'menuitem'}
      aria-checked={it.select ? !!it.checked : undefined}
      className={cx('menu__item', it.checked && 'is-checked', it.danger && 'is-danger', focused && 'is-focus')}
      onClick={onPick}
      disabled={it.disabled}
    >
      {it.leading ?? (it.img ? <img className="menu__logo" src={it.img} alt="" /> : it.avatar ? <Avatar agent={it.avatar} size="sm" /> : it.ic ? <Icon name={it.ic} /> : null)}
      <span className="menu__item-text"><span>{it.avatar ? it.label : t(it.label)}</span>{it.desc && <span className="menu__item-desc">{t(it.desc)}</span>}</span>
      {it.hint && <span className="menu__item-hint">{it.hint}</span>}
      {it.select ? <SelMark kind={it.select} on={!!it.checked} /> : it.checked ? <Icon name="check" className="menu__check" /> : null}
      {it.sub && <Icon name="chevronRight" />}
    </button>
  );
}
