import { Avatar } from '@/shared/ui/Agent';
import { logoUrl } from '@/features/settings/runtime/agents';
import { memberAgentRow } from '../runtime/team';
import { agent } from '@/state/selectors';
import { cx } from '@/shared/lib/util';

/** 团队成员头像：Lom 与手机用通用头像，本机 Agent 用它自己的图标 */
export function MemberAvatar({ id, size, crown, status, name }: { id: string; name?: string; size?: 'sm' | 'lg'; crown?: boolean; status?: boolean }) {
  const row = memberAgentRow(id);
  if (!row && id.startsWith('ag:')) return <Avatar agent={{ kind: 'user', name: name || 'Agent' }} size={size} />;
  if (!row) return <Avatar agent={agent(id)} size={size} crown={crown} status={status} />;
  const logo = logoUrl(row.icon);
  return (
    <span className={cx('avatar', 'avatar--computer', size && `avatar--${size}`)} aria-hidden="true">
      {logo ? <img className="avatar__image" src={logo} alt="" /> : row.name.slice(0, 1)}
    </span>
  );
}
