import { t } from '../i18n/index';
import type { AriaAttributes, MouseEvent, ReactNode } from 'react';
import { openMenu } from '../overlays/controller';
import type { MenuCtx } from '@/state/types';
import { cx } from '../lib/util';
import { Icon } from './Icon';

/* ===== 按钮族：同一种按钮只有这一份实现 ===== */

type Click = (e: MouseEvent<HTMLButtonElement>) => void;
export type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost' | 'link' | 'pill';

export interface BtnProps extends Pick<AriaAttributes, 'aria-haspopup' | 'aria-expanded'> {
  label?: ReactNode; ic?: string; icRight?: string; variant?: BtnVariant; size?: 'sm' | 'lg';
  onClick?: Click; disabled?: boolean; title?: string; block?: boolean; active?: boolean; className?: string;
  /** 弱化显示但仍可点击：用于「当前没有可用档位」，点开能看到原因 */
  dim?: boolean;
}

/* 按钮：variant = primary | secondary | ghost | danger | danger-ghost | link | pill */
export function Btn({ label, ic, icRight, variant = 'secondary', size, onClick, disabled, title, block, active, className, dim, 'aria-haspopup': hasPopup, 'aria-expanded': expanded }: BtnProps) {
  return (
    <button
      type="button"
      className={cx('btn', `btn--${variant}`, size && `btn--${size}`, block && 'btn--block', active && 'is-active', dim && 'is-dim', className)}
      onClick={onClick}
      disabled={disabled}
      title={t(title)}
      aria-haspopup={hasPopup}
      aria-expanded={expanded}
      aria-pressed={active === undefined ? undefined : !!active}
    >
      {ic && <Icon name={ic} />}
      {label !== undefined && label !== '' && <span>{t(label)}</span>}
      {icRight && <Icon name={icRight} />}
    </button>
  );
}

/* 图标按钮：必须有 label（无障碍名称 + 悬停提示） */
export function IconBtn({ ic, label, onClick, variant, size, active, disabled, className }: {
  ic: string; label: string; onClick?: Click; variant?: 'soft' | 'round'; size?: 'sm'; active?: boolean; disabled?: boolean; className?: string;
}) {
  return (
    <button
      type="button"
      className={cx('ibtn', variant && `ibtn--${variant}`, size && `ibtn--${size}`, active && 'is-active', className)}
      onClick={onClick}
      aria-label={t(label)}
      title={t(label)}
      disabled={disabled}
    >
      <Icon name={ic} />
    </button>
  );
}

/* 下拉触发器：打开 menus 注册表里的某个菜单 */
export function Dropdown({ label, ic, menu, ctx = {}, variant = 'pill', size, title, align, className, dim }: {
  label: ReactNode; ic?: string; menu: string; ctx?: MenuCtx; variant?: BtnVariant; size?: 'sm'; title?: string; align?: 'start' | 'end'; className?: string;
  /** 弱化显示：当前没有可用档位，但点开仍能看到原因 */
  dim?: boolean;
}) {
  return (
    <Btn
      label={t(label)} ic={ic} icRight="chevron" variant={variant} size={size} dim={dim} title={t(title)} className={className}
      onClick={e => openMenu(menu, e.currentTarget, { ...ctx, ...(align ? { align } : {}) })}
    />
  );
}

/* 导航行 */
export function NavItem({ label, ic, onClick, active, trail, size, title }: {
  label: string; ic?: string; onClick?: Click; active?: boolean; trail?: ReactNode; size?: 'sm'; title?: string;
}) {
  return (
    <button type="button" className={cx('nav-item', size && `nav-item--${size}`, active && 'is-active')} onClick={onClick} aria-current={active ? 'page' : undefined} title={t(title)}>
      {ic && <Icon name={ic} />}
      <span className="nav-item__label">{t(label)}</span>
      {trail !== undefined && trail !== '' && <span className="nav-item__trail">{trail}</span>}
    </button>
  );
}
