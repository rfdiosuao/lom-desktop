import { cardNavigation, type CardNavigation } from './cardNavigation';
import { useRef, useState } from 'react';
import { Badge } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { focusTaskCard } from './activityFocus';
import { USER_IDENTITY } from './activityTypes';
import type { TeamTask } from './activityTypes';
import { formatActivityTime } from './activityTime';
import type { IdentityResolver } from './MessageCard';
import { clampStyle, useIsClamped } from './useIsClamped';

/* D33 任务卡：状态、负责人、主题、描述截断、依赖、时间。 */

const STATUS_LABEL: Record<string, string> = { pending: '待办', in_progress: '进行中', completed: '已完成', deleted: '已删除' };
const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'info' | undefined> = {
  pending: 'info', in_progress: 'warn', completed: 'ok', deleted: 'danger',
};

type Props = { task: TeamTask; identity: IdentityResolver; navigation?: CardNavigation };

export function TaskCard({ task, identity, navigation }: Props) {
  const [expanded, setExpanded] = useState(false);
  const descRef = useRef<HTMLDivElement>(null);

  const owner = task.owner ?? '';
  const ownerName = !owner || owner === USER_IDENTITY ? '用户 / 外部' : identity.nameOf(owner);
  const ownerColor = !owner || owner === USER_IDENTITY ? 'var(--placeholder)' : identity.colorOf(owner);
  const description = task.description ?? '';
  const isClamped = useIsClamped(descRef, [description, expanded]);
  const time = formatActivityTime(task.created_at);

  return (
    <article {...cardNavigation(navigation)} className={navigation ? 'act-card act-card--linked' : 'act-card'} data-testid="activity-task-card" data-task-id={task.id}>
      <header className="act-card__head">
        <Icon name="check" className="act-card__kind" />
        <span className="act-card__subject" title={task.subject}>{task.subject}</span>
        <Badge text={STATUS_LABEL[task.status] || task.status} tone={STATUS_TONE[task.status]} />
      </header>

      <div className="act-card__owner">
        <span className="act-card__dot" style={{ background: ownerColor }} aria-hidden="true" />
        <span className="act-card__name" title={ownerName}>{ownerName}</span>
      </div>

      {task.blocked_by.length > 0 && (
        <div className="act-card__deps">
          {task.blocked_by.map((dep) => (
            <button key={dep} type="button" className="act-card__dep" title={`被 #${dep.slice(0, 8)} 阻塞；任务已在看板上时点击跳转`} onClick={() => focusTaskCard(dep)}>
              <Icon name="lock" /> 被 #{dep.slice(0, 8)} 阻塞
            </button>
          ))}
        </div>
      )}

      {description.length > 0 && (
        <div ref={descRef} className="act-card__body act-card__body--desc" style={expanded ? undefined : clampStyle(2)}>{description}</div>
      )}

      <footer className="act-card__foot">
        {description.length > 0 && (isClamped || expanded) && (
          <button type="button" className="act-card__more" aria-expanded={expanded} data-testid="activity-task-expand" onClick={() => setExpanded((v) => !v)}>
            {expanded ? '收起' : '展开'}
          </button>
        )}
        <time className="act-card__time" title={time.full}>{time.label}</time>
      </footer>
    </article>
  );
}
