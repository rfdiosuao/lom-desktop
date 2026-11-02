import { useRef, useState } from 'react';
import { Badge } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { cardNavigation, type CardNavigation } from './cardNavigation';
import { formatActivityTime } from './activityTime';
import type { PhoneActivity } from './phoneActivity';
import { clampStyle, useIsClamped } from './useIsClamped';

/** Phone messages show their actual source, without claiming mailbox delivery or read status. */
export function PhoneActivityCard({ activity, at, navigation }: { activity: PhoneActivity; at: number; navigation?: CardNavigation }) {
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const clamped = useIsClamped(bodyRef, [activity.text, expanded]);
  const time = formatActivityTime(at);
  return (
    <article {...cardNavigation(navigation)} className={navigation ? 'act-card act-card--linked' : 'act-card'} data-testid="activity-phone-card">
      <header className="act-card__head">
        <Icon name={activity.category === 'task' ? 'phone' : 'message'} className="act-card__kind" />
        <span className="act-card__subject" title={activity.title}>{activity.title}</span>
        <Badge text={activity.label} />
      </header>
      {activity.text && <div ref={bodyRef} className="act-card__body" style={expanded ? undefined : clampStyle(3)}>{activity.text}</div>}
      <footer className="act-card__foot">
        <span>手机会话 · 本机同步</span>
        {activity.files > 0 && <span className="act-card__files"><Icon name="file" />{activity.files} 个附件</span>}
        {(clamped || expanded) && <button type="button" className="act-card__more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : '展开'}</button>}
        <time className="act-card__time" title={time.full}>{time.label}</time>
      </footer>
    </article>
  );
}
