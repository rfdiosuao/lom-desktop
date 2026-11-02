import type { MouseEvent, ReactNode } from 'react';
import { openMenu } from '../overlays/controller';
import { personaOf } from '@/state/selectors';
import type { Agent } from '@/state/types';
import { cx } from '../lib/util';
import { Dot } from './Controls';
import { Icon } from './Icon';

/* ===== Agent 相关控件：头像、选择标记、Agent 胶囊、手机选择按钮 ===== */

type AvatarAgent = Pick<Agent, 'kind' | 'name'> & { status?: Agent['status']; avatar?: string };

/* 头像：电脑主控 / 手机 / 用户 统一 */
export function Avatar({ agent, size, crown, status }: { agent?: AvatarAgent | null; size?: 'sm' | 'lg'; crown?: boolean; status?: boolean }) {
  if (!agent) return null;
  const kind = agent.kind === 'computer' ? 'computer' : agent.kind === 'phone' ? 'phone' : 'user';
  const off = agent.status === 'offline';
  return (
    <span className={cx('avatar', `avatar--${kind}`, size && `avatar--${size}`, off && 'is-offline')} aria-hidden="true">
      {kind === 'user' && agent.avatar ? <img key={agent.avatar} className="avatar__image" src={agent.avatar} alt="" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} /> : null}
      {kind === 'computer' ? <Icon name="monitor" /> : kind === 'phone' ? <Icon name="phone" /> : (agent.name || '?').slice(0, 1)}
      {crown && <span className="avatar__crown"><Icon name="crown" /></span>}
      {status && <span className={cx('avatar__status', off && 'is-offline')} />}
    </span>
  );
}

/* 选择标记：多选 = 方形勾选框，单选 = 圆形单选点。胶囊、菜单、列表统一使用 */
export function SelMark({ kind, on }: { kind: 'multi' | 'single'; on: boolean }) {
  return kind === 'multi'
    ? <span className={cx('sel', 'sel--check', on && 'is-on')} aria-hidden="true"><Icon name="check" /></span>
    : <span className={cx('sel', 'sel--radio', on && 'is-on')} aria-hidden="true" />;
}

/* 选择组标题：「参与本次任务的手机 · 可多选」/「当前对话的 Agent · 单选」 */
export function SelLabel({ title, kind, extra }: { title: string; kind: 'multi' | 'single'; extra?: ReactNode }) {
  return (
    <div className="sel-label">
      <span className="sel-label__title">{title}</span>
      <span className="sel-label__kind"><SelMark kind={kind} on />{kind === 'multi' ? '可多选' : '单选'}</span>
      {extra && <span className="sel-label__extra">{extra}</span>}
    </div>
  );
}

/* Agent 胶囊：select = 'multi'（多选勾选）| 'single'（单选高亮）| 不传（普通标签，如团队成员）
 * 在线状态统一画在头像右下角，避免和选择标记混淆 */
export function Chip({ agent, title, sub, selected, onClick, size, variant, select, crown, label }: {
  agent?: Agent; title?: string; sub?: string; selected?: boolean; onClick?: () => void;
  size?: 'sm'; variant?: 'tab'; select?: 'multi' | 'single'; crown?: boolean; label?: string;
}) {
  const t = title ?? agent?.name;
  const s = sub ?? agent?.persona;
  const role = select === 'multi' ? 'checkbox' : select === 'single' ? 'radio' : undefined;
  return (
    <button
      type="button"
      className={cx('chip', size && `chip--${size}`, variant && `chip--${variant}`, select && `chip--${select}`, selected && 'is-selected')}
      onClick={onClick}
      role={role}
      aria-checked={select ? !!selected : undefined}
      aria-pressed={select ? undefined : !!selected}
      aria-label={label}
    >
      <Avatar agent={agent} size={size === 'sm' || variant === 'tab' ? 'sm' : undefined} crown={crown} status={agent?.kind === 'phone'} />
      <span className="chip__text">
        <span className="chip__title">{t}</span>
        {s && variant !== 'tab' && <span className="chip__sub">{s}</span>}
      </span>
      {select && <SelMark kind={select} on={!!selected} />}
    </button>
  );
}

/* 首页「配对新手机」虚线胶囊（与 Agent 胶囊同一外形） */
export function ChipAdd({ label = '添加手机', onClick }: { label?: string; onClick: () => void }) {
  return <button type="button" className="chip chip--add" onClick={onClick}><Icon name="plus" /><span className="chip__title">{label}</span></button>;
}

/* 手机选择按钮：侧栏「选择手机」与工作区设备头共用 */
export function DeviceButton({ phone, variant = 'sidebar', menuKey }: { phone: Agent; variant?: 'sidebar' | 'panel'; menuKey?: string }) {
  const online = phone.status === 'online';
  const sub = variant === 'sidebar'
    ? `${phone.name} · ${personaOf(phone)}`
    : `${personaOf(phone)} · ${phone.network || '网络未知'}${online ? ` · ${Number.isFinite(phone.battery) ? `电量 ${phone.battery}%` : '电量暂不可用'}` : ''}`;
  const open = (e: MouseEvent<HTMLButtonElement>) => openMenu('phonePick', e.currentTarget, { matchWidth: '1', key: menuKey || `pick${variant}` });
  return (
    <button type="button" className={`device-btn device-btn--${variant}`} onClick={open} aria-label={`选择手机，当前：${phone.name}`}>
      <Avatar agent={phone} status />
      <span className="device-btn__text">
        <span className="device-btn__title">{variant === 'sidebar' ? '选择手机' : <>{phone.name} <Icon name="chevron" /></>}</span>
        <span className="device-btn__sub">{sub}</span>
      </span>
      {variant === 'sidebar'
        ? <Icon name="chevron" />
        : <span className={cx('row', !online && 'muted')} style={{ fontSize: 13 }}><Dot status={online ? 'online' : 'offline'} />{online ? '在线' : '离线'}</span>}
    </button>
  );
}
