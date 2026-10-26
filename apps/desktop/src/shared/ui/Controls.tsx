import { t, t as translate } from '../i18n/index';
import type { ReactNode } from 'react';
import { cx } from '../lib/util';
import { Icon } from './Icon';

/* ===== 选择类控件：分段、标签页、开关、状态点、徽章、按键 ===== */

export interface SegOption<V extends string> { value: V; label?: string; ic?: string; title?: string; addon?: ReactNode; }

/* 分段控件；选项可带 addon（嵌在同一个胶囊里的小按钮，例如「手机」里的「+」） */
export function Seg<V extends string>({ options, value, onChange, variant, block }: {
  options: SegOption<V>[]; value: V; onChange: (v: V) => void; variant?: 'brand'; block?: boolean;
}) {
  return (
    <div className={cx('seg', variant && `seg--${variant}`, block && 'seg--block')} role="radiogroup">
      {options.map(o => {
        const on = o.value === value;
        const opt = (
          <button key={o.value} type="button" role="radio" aria-checked={on} className={cx('seg__opt', on && 'is-active')} onClick={() => onChange(o.value)} title={o.title}>
            {o.ic && <Icon name={o.ic} />}
            {o.label && <span>{t(o.label)}</span>}
          </button>
        );
        return o.addon ? <div key={o.value} className={cx('seg__group', on && 'is-active')}>{opt}{o.addon}</div> : opt;
      })}
    </div>
  );
}

/* 标签页 */
export function Tabs<V extends string>({ items, value, onChange, fill }: {
  items: { value: V; label: string; count?: number }[]; value: V; onChange: (v: V) => void; fill?: boolean;
}) {
  return (
    <div className={cx('tabs', fill && 'tabs--fill')} role="tablist">
      {items.map(t => (
        <button key={t.value} type="button" role="tab" aria-selected={t.value === value} className={cx('tabs__tab', t.value === value && 'is-active')} onClick={() => onChange(t.value)}>
          {translate(t.label)}
          {t.count !== undefined && <span className="tabs__count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* 开关 */
export function Toggle({ on, onChange, label, size, disabled }: { on: boolean; onChange: () => void; label?: string; size?: 'sm'; disabled?: boolean }) {
  return <button type="button" role="switch" disabled={disabled} aria-checked={!!on} aria-label={t(label || '开关')} className={cx('toggle', size && `toggle--${size}`, on && 'is-on')} onClick={onChange} />;
}

export const Dot = ({ status = 'online' }: { status?: 'online' | 'offline' }) => <span className={`dot dot--${status}`} aria-hidden="true" />;

export function Badge({ text, tone, ic }: { text: ReactNode; tone?: 'ok' | 'warn' | 'danger' | 'info' | 'live' | 'brand'; ic?: string }) {
  return <span className={cx('badge', tone && `badge--${tone}`)}>{ic && <Icon name={ic} />}{t(text)}</span>;
}

export const Kbd = ({ k }: { k: string }) => <span className="kbd">{k}</span>;

export const Spinner = ({ size }: { size?: number }) => (
  <span className="spinner" aria-hidden="true" style={size ? { width: size, height: size } : undefined}>
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="10" cy="10" r="8" opacity=".2" />
      <path d="M10 2a8 8 0 1 1-8 8" strokeLinecap="round" />
    </svg>
  </span>
);

export const Typing = ({ inline }: { inline?: boolean }) => <span className="typing" aria-hidden="true" style={inline ? { marginLeft: 4 } : undefined}><i /><i /><i /></span>;
