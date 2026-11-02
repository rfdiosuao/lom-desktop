import { useState, type ReactNode } from 'react';
import { readAudit, clearAudit } from '@/features/settings/runtime/audit';
import { closeModal, topModal, confirm } from '@/shared/overlays/controller';
import { saveAccountProfile } from '@/features/settings/actions/settings';
import { chooseAvatar } from '@/features/account/actions/avatar';
import { Avatar } from '@/shared/ui/Agent';
import { Btn } from '@/shared/ui/Button';
import { Kbd } from '@/shared/ui/Controls';
import { Field, IconTile, Input, ListRow } from '@/shared/ui/Layout';
import { Modal } from '@/shared/ui/Overlay';
import { S, update, useStore } from '@/state/store';

/* ===== 通用弹窗：确认、输入、快捷键、审计日志、反馈、资料 ===== */

type P = Record<string, unknown>;

export function ConfirmModal({ p }: { p: P }) {
  const ok = () => { const m = topModal(); update(s => { s.modals.pop(); }); (m?.props.onOk as (() => void) | undefined)?.(); };
  return (
    <Modal title={String(p.title)} desc={p.desc as string | undefined} size="sm"
      foot={<><Btn label="取消" variant="secondary" onClick={closeModal} /><Btn label={String(p.okText || '确定')} variant={p.danger ? 'danger' : 'primary'} onClick={ok} /></>} />
  );
}

export function PromptModal({ p }: { p: P }) {
  const ok = () => {
    const m = topModal(), v = String(S.form.value ?? '').trim();
    update(s => { s.modals.pop(); });
    (m?.props.onOk as ((v: string) => void) | undefined)?.(v);
  };
  return (
    <Modal title={String(p.title)} size="sm"
      foot={<><Btn label="取消" variant="secondary" onClick={closeModal} /><Btn label={String(p.okText || '保存')} variant="primary" onClick={ok} /></>}>
      <Field label={String(p.label)}><Input bind="form.value" placeholder={p.placeholder as string | undefined} autoFocus /></Field>
      {p.extra as ReactNode}
    </Modal>
  );
}

const KEYS: [string, string][] = [['⌘ K', '搜索 / 命令面板'], ['⌘ N', '新的任务'], ['⌘ B', '收起 / 展开侧栏'], ['⌘ ⌥ B', '收起 / 展开工作区'], ['Enter', '发送'], ['Shift Enter', '换行'], ['Esc', '停止 / 关闭弹窗'], ['@', '提及手机或文件'], ['/', '快捷命令']];
export function ShortcutsModal() {
  return (
    <Modal title="快捷键" size="sm">
      <div className="list">
        {KEYS.map(([k, d]) => (
          <div key={d} className="list-row" style={{ minHeight: 44 }}><span className="grow" style={{ fontSize: 14 }}>{d}</span>{k.split(' ').map(x => <Kbd key={x} k={x} />)}</div>
        ))}
      </div>
    </Modal>
  );
}

export function AuditModal() {
  const [version, refresh] = useState(0);
  let entries: ReturnType<typeof readAudit> = [], error = '';
  try { entries = readAudit().reverse(); } catch (e) { error = String(e); }
  return <Modal title="操作审计日志" desc="当前账号在本机收到的工具记录，最多保留 1000 条。只记录工具类型、时间和结果；完整内容请查看原会话。不是防篡改审计。" size="lg"
    foot={<><Btn label="刷新" onClick={() => refresh(version + 1)} /><Btn label="清空记录" variant="danger-ghost" onClick={() => confirm({ title: '清空本机操作记录？', onOk: () => { clearAudit(); refresh(version + 1); } })} /></>}>
    {error ? <p role="alert">{error}</p> : <div className="list">{entries.length ? entries.map(row => <ListRow key={row.id} lead={<IconTile ic="terminal" />} title={row.tool} sub={`${new Date(row.at).toLocaleString()} · ${row.status}`} meta={row.conversation} />) : <p className="muted">暂无操作记录。开启记录后，新的工具调用会显示在这里。</p>}</div>}
  </Modal>;
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
