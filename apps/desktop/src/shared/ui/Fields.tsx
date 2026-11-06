import { useState, type ReactNode } from 'react';
import { t } from '../i18n/index';
import { cx } from '../lib/util';
import { IconBtn } from './Button';

/* ===== 表单控件：单选组、带显示/隐藏的密文输入框、带字数计数的输入框 ===== */

export function RadioGroup<V extends string>({ options, value, onChange, label, disabled }: {
  options: { value: V; label: string }[]; value: V; onChange: (v: V) => void; label: string; disabled?: boolean;
}) {
  return (
    <div className="radios" role="radiogroup" aria-label={t(label)}>
      {options.map(o => (
        <label key={o.value} className="radios__opt">
          <input type="radio" checked={o.value === value} disabled={disabled} onChange={() => onChange(o.value)} />
          <span>{t(o.label)}</span>
        </label>
      ))}
    </div>
  );
}

/** 密文输入框：默认隐藏，右侧眼睛图标切换显示；不触发浏览器自动填充。 */
export function SecretInput({ value, onChange, placeholder, label, disabled }: {
  value: string; onChange: (v: string) => void; placeholder?: string; label: string; disabled?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="affix">
      <input className="input" type={shown ? 'text' : 'password'} value={value} disabled={disabled} autoComplete="off" spellCheck={false}
        placeholder={t(placeholder)} aria-label={t(label)} onChange={e => onChange(e.target.value)} />
      <IconBtn ic={shown ? 'eye' : 'eyeOff'} label={shown ? t('隐藏') : t('显示')} size="sm" className="affix__end" onClick={() => setShown(v => !v)} />
    </div>
  );
}

/** 带“当前字数 / 上限”计数的单行或多行输入框；extra 放在输入框内右下角（例如上传按钮）。 */
export function CountedInput({ value, onChange, max, placeholder, label, multiline, disabled, extra }: {
  value: string; onChange: (v: string) => void; max: number; placeholder?: string; label: string; multiline?: boolean; disabled?: boolean; extra?: ReactNode;
}) {
  const shared = { value, disabled, placeholder: t(placeholder), 'aria-label': t(label), maxLength: max };
  return (
    <div className={cx('affix', multiline && 'affix--area')}>
      {multiline
        ? <textarea className="textarea" rows={3} {...shared} onChange={e => onChange(e.target.value)} />
        : <input className="input" {...shared} onChange={e => onChange(e.target.value)} />}
      <span className="affix__count" aria-hidden="true">{value.length} / {max}</span>
      {extra}
    </div>
  );
}
