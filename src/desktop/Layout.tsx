import type { CSSProperties, ReactNode } from 'react';
import { t } from './labels';
import { cx } from './utils';
import { Icon } from '../components/Icon';

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
