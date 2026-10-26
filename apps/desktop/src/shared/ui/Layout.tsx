import { t } from '../i18n/index';
import { phoneSyncError } from '@/features/phones/runtime/phoneSync';
import type { CSSProperties, ReactNode } from 'react';
import { getPath, setPath, update } from '@/state/store';
import type { Agent, Skill } from '@/state/types';
import { cx } from '../lib/util';
import { Icon } from './Icon';

/* ===== 版面类控件：列表行、空状态、页面头、分区、设置行、表单、图标块 ===== */

/* 列表行 */
export function ListRow({ lead, title, titleExtra, sub, meta, actions, onClick, className, style }: {
  lead?: ReactNode; title?: ReactNode; titleExtra?: ReactNode; sub?: ReactNode; meta?: ReactNode; actions?: ReactNode;
  onClick?: () => void; className?: string; style?: CSSProperties;
}) {
  const inner = (
    <>
      {lead}
      <div className="list-row__main">
        <div className="list-row__title">{title}{titleExtra}</div>
        {sub && <div className="list-row__sub">{sub}</div>}
      </div>
      {meta && <div className="list-row__meta">{meta}</div>}
      {actions && <div className="list-row__actions">{actions}</div>}
    </>
  );
  return onClick
    ? <button type="button" className={cx('list-row', 'list-row--btn', className)} onClick={onClick} style={style}>{inner}</button>
    : <div className={cx('list-row', className)} style={style}>{inner}</div>;
}

/* 空状态 */
export function Empty({ ic = 'info', title, desc, actions }: { ic?: string; title: string; desc?: string; actions?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon"><Icon name={ic} /></div>
      <div className="empty__title">{t(title)}</div>
      {desc && <div className="empty__desc">{t(desc)}</div>}
      {actions && <div className="row" style={{ marginTop: 8 }}>{actions}</div>}
    </div>
  );
}

/* 页面头 */
export function PageHead({ title, desc, actions, extra }: { title: string; desc?: string; actions?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-head__title">{t(title)}</h1>
        {desc && <p className="page-head__desc">{t(desc)}</p>}
        {extra}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </div>
  );
}

export function Section({ title, children, extra, hint }: { title: string; children: ReactNode; extra?: ReactNode; hint?: string }) {
  return (
    <section className="section">
      <h2 className="section__title">{t(title)}{extra}</h2>
      {children}
      {hint && <p className="section__hint">{t(hint)}</p>}
    </section>
  );
}

/* 设置行与设置卡 */
export function SettingRow({ title, desc, control }: { title: string; desc?: ReactNode; control?: ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <div className="setting-row__title">{t(title)}</div>
        {desc && <div className="setting-row__desc">{t(desc)}</div>}
      </div>
      {control}
    </div>
  );
}
export const SettingCard = ({ children }: { children: ReactNode }) => <div className="card card--settings">{children}</div>;

/* 表单 */
export function Field({ label, req, hint, children, inline }: { label: string; req?: boolean; hint?: string; children: ReactNode; inline?: boolean }) {
  return (
    <div className={cx('field', inline && 'field--inline')}>
      <label className="field__label">{t(label)}{req && <span className="req">*</span>}</label>
      <div className="grow">
        {children}
        {hint && <div className="field__hint" style={{ marginTop: 6 }}>{t(hint)}</div>}
      </div>
    </div>
  );
}

/** 绑定到状态树路径的输入框（例如 bind="form.name"） */
export function Input({ bind, value, onChange, placeholder, type = 'text', autoFocus, className, style }: {
  bind?: string; value?: string; onChange?: (v: string) => void; placeholder?: string; type?: string; autoFocus?: boolean; className?: string; style?: CSSProperties;
}) {
  const v = value ?? (bind ? String(getPath(bind) ?? '') : '');
  return (
    <input
      className={cx('input', className)} type={type} value={v} placeholder={t(placeholder)} autoFocus={autoFocus} style={style}
      onChange={e => { const nv = e.target.value; if (onChange) onChange(nv); else if (bind) update(() => setPath(bind, nv)); }}
    />
  );
}

export function Textarea({ bind, placeholder, rows = 4, mono, onChange, ariaLabel }: {
  bind: string; placeholder?: string; rows?: number; mono?: boolean; onChange?: (v: string) => void; ariaLabel?: string;
}) {
  return (
    <textarea
      className={cx('textarea', mono && 'textarea--mono')} rows={rows} placeholder={t(placeholder)} aria-label={ariaLabel}
      value={String(getPath(bind) ?? '')}
      onChange={e => { const nv = e.target.value; update(() => setPath(bind, nv)); onChange?.(nv); }}
    />
  );
}

export function Search({ bind, placeholder = '搜索', autoFocus }: { bind: string; placeholder?: string; autoFocus?: boolean }) {
  return <div className="search"><Icon name="search" /><Input bind={bind} placeholder={t(placeholder)} autoFocus={autoFocus} /></div>;
}

/* 同步状态（手机数据） */
export function SyncState({ phone }: { phone: Agent }) {
  const error = phone.real ? phoneSyncError(phone.id) : '';
  return <span className="muted">{error ? `同步未完成：${error}` : phone.status === 'offline' ? '手机离线 · 显示本机缓存' : phone.real ? '已连接 · 每 5 秒同步' : '演示数据'}</span>;
}

/* 图标块：列表行前缀、事件卡片图标、技能图标统一使用 */
export function IconTile({ ic, color, size }: { ic: string; color?: string; size?: number }) {
  const style: CSSProperties = {
    ...(color ? { background: color, color: '#fff' } : {}),
    ...(size ? { width: size, height: size, borderRadius: Math.round(size * 0.27) } : {}),
  };
  return <span className="event__icon" style={color || size ? style : undefined}><Icon name={ic} /></span>;
}
export const SkillIcon = ({ skill, size = 44 }: { skill: Skill; size?: number }) => <IconTile ic={skill.ic} color={skill.color} size={size} />;

/** 演示标注：手机端与云端接入前，相关页面显示这行说明 */
export function DemoNote({ text = '演示数据 · 手机端接入后显示真实内容' }: { text?: string }) {
  return <span className="demo-note"><Icon name="info" />{text}</span>;
}
