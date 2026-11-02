import { cardNavigation, type CardNavigation } from './cardNavigation';
import { useRef, useState } from 'react';
import { Badge } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { BROADCAST_TARGET, isBroadcastMessage, isSystemMessageType, USER_IDENTITY } from './activityTypes';
import type { TeamMailboxMessage } from './activityTypes';
import { formatActivityTime } from './activityTime';
import { clampStyle, useIsClamped } from './useIsClamped';

/* D33 消息卡：发件人 → 收件人、未读/已读、3 行截断 + 展开、附件数、时间。 */

const SYSTEM_LABEL: Record<string, string> = { idle_notification: '空闲通知', shutdown_request: '停止请求' };
const USER_LABEL = '用户 / 外部';

export interface IdentityResolver {
  nameOf: (slotId: string) => string;
  colorOf: (slotId: string) => string;
}

type Props = { message: TeamMailboxMessage; identity: IdentityResolver; navigation?: CardNavigation };

function Member({ name, color }: { name: string; color: string }) {
  return (
    <span className="act-card__member">
      <span className="act-card__dot" style={{ background: color }} aria-hidden="true" />
      <span className="act-card__name" title={name}>{name}</span>
    </span>
  );
}

export function MessageCard({ message, identity, navigation }: Props) {
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const broadcast = isBroadcastMessage(message);
  const system = isSystemMessageType(message.msg_type);
  const body = message.summary && message.summary.length > 0 ? message.summary : message.content;
  const colorOf = (slot: string) => (slot === USER_IDENTITY || !slot || slot === BROADCAST_TARGET ? 'var(--placeholder)' : identity.colorOf(slot));
  const nameOf = (slot: string) => (slot === USER_IDENTITY ? USER_LABEL : identity.nameOf(slot));
  const fromName = nameOf(message.from_agent_id);
  const toName = broadcast ? '广播给全员' : nameOf(message.to_agent_id);
  const isClamped = useIsClamped(bodyRef, [body, expanded]);
  const time = formatActivityTime(message.created_at);

  return (
    <article {...cardNavigation(navigation)} className={navigation ? 'act-card act-card--linked' : 'act-card'} data-testid="activity-message-card" data-message-id={message.id}>
      <header className="act-card__head">
        <Icon name="message" className="act-card__kind" />
        <Member name={fromName} color={colorOf(message.from_agent_id)} />
        <span className="act-card__arrow" aria-hidden="true">→</span>
        <Member name={toName} color={colorOf(message.to_agent_id)} />
        <span className="act-card__tags">
          {system && <Badge text={SYSTEM_LABEL[message.msg_type] || message.msg_type} />}
          <Badge text={message.read ? '已读' : '未读'} tone={message.read ? undefined : 'warn'} />
        </span>
      </header>

      {body.length > 0 && (
        <div ref={bodyRef} className="act-card__body" style={expanded ? undefined : clampStyle(3)}>{body}</div>
      )}

      <footer className="act-card__foot">
        {message.files.length > 0 && (
          <span className="act-card__files"><Icon name="file" /> {message.files.length} 个附件</span>
        )}
        {body.length > 0 && (isClamped || expanded) && (
          <button type="button" className="act-card__more" aria-expanded={expanded} data-testid="activity-message-expand" onClick={() => setExpanded((v) => !v)}>
            {expanded ? '收起' : '展开'}
          </button>
        )}
        <time className="act-card__time" title={time.full}>{time.label}</time>
      </footer>
    </article>
  );
}
