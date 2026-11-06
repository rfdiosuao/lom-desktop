import { t } from '@/shared/i18n/index';
import { useRef, type ReactNode } from 'react';
import { closeModal, topModal } from '@/shared/overlays/controller';
import { saveAccountProfile } from '@/features/settings/actions/settings';
import { shortcutRows } from './shortcuts';
import { chooseAvatar } from '@/features/account/actions/avatar';
import { Avatar } from '@/shared/ui/Agent';
import { Btn } from '@/shared/ui/Button';
import { Kbd } from '@/shared/ui/Controls';
import { Field, Input } from '@/shared/ui/Layout';
import { Modal } from '@/shared/ui/Overlay';
import { S, update, useStore } from '@/state/store';

/* ===== 通用弹窗：确认、输入、快捷键、审计日志、反馈、资料 ===== */

type P = Record<string, unknown>;

export function ConfirmModal({ p }: { p: P }) {
  const ok = () => { const m = topModal(); update(s => { s.modals.pop(); }); (m?.props.onOk as (() => void) | undefined)?.(); };
  return (
    <Modal title={String(p.title)} desc={p.desc as string | undefined} size="sm"
      foot={<><Btn label={String(p.cancelText || '取消')} variant="secondary" onClick={closeModal} /><Btn label={String(p.okText || '确定')} variant={p.danger ? 'danger' : 'primary'} onClick={ok} /></>} />
  );
}

export function PromptModal({ p }: { p: P }) {
  const s = useStore(), box = useRef<HTMLDivElement>(null);
  const ok = () => {
    const m = topModal(), v = String(S.form.value ?? '').trim();
    // UI-AUDIT-02 UI-11：校验在弹窗内完成；不通过时不关闭，保留输入和头像等草稿，焦点回到输入框
    const error = (m?.props.validate as ((v: string) => string | undefined) | undefined)?.(v);
    if (error) { update(x => { x.form.error = error; }); box.current?.querySelector('input')?.focus(); return; }
    update(s => { s.modals.pop(); });
    (m?.props.onOk as ((v: string) => void) | undefined)?.(v);
  };
  return (
    <Modal title={String(p.title)} size="sm"
      foot={<><Btn label="取消" variant="secondary" onClick={closeModal} /><Btn label={String(p.okText || '保存')} variant="primary" onClick={ok} /></>}>
      <div ref={box}><Field label={String(p.label)}><Input bind="form.value" placeholder={p.placeholder as string | undefined} autoFocus /></Field></div>
      {s.form.error && <p className="form-error" role="alert">{String(s.form.error)}</p>}
      {p.extra as ReactNode}
    </Modal>
  );
}

export function ShortcutsModal() {
  return (
    <Modal title="快捷键" size="sm">
      <div className="list">
        {shortcutRows().map(([k, d]) => (
          <div key={d} className="list-row" style={{ minHeight: 44 }}><span className="grow" style={{ fontSize: 14 }}>{t(d)}</span>{k.split(' ').map(x => <Kbd key={x} k={x} />)}</div>
        ))}
      </div>
    </Modal>
  );
}

export function ProfileModal() {
  const s = useStore(), f = s.form;
  const busy = !!f.saving || !!f.reading;
  return (
    <Modal title="编辑资料" size="sm" desc="昵称和头像保存到当前账号，重新登录后依然保留。"
      foot={<><Btn label="取消" variant="secondary" onClick={closeModal} disabled={busy} /><Btn label={f.saving ? '保存中…' : '保存'} variant="primary" onClick={() => void saveAccountProfile()} disabled={busy || !String(f.name || '').trim()} /></>}>
      <div className="profile-avatar">
        <Avatar agent={{ kind: 'user', name: f.name, avatar: f.avatar === null ? s.account?.provider_avatar : f.avatar }} size="lg" />
        <label>更换头像<input aria-label="选择头像图片" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { void chooseAvatar(e.target.files?.[0]); e.target.value = ''; }} /></label>
      </div>
      <div className="row">
        {s.account?.provider_avatar && <Btn label="使用登录账号头像" variant="ghost" size="sm" disabled={busy} onClick={() => update(() => { f.avatar = null; })} />}
        <Btn label="使用昵称头像" variant="ghost" size="sm" disabled={busy} onClick={() => update(() => { f.avatar = ''; })} />
      </div>
      <Field label="昵称（最多 40 字）"><Input bind="form.name" autoFocus /></Field>
      {f.error && <p className="form-error" role="alert">{f.error}</p>}
    </Modal>
  );
}
