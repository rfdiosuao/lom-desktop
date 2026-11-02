import { PhoneActivityCard } from './PhoneActivityCard';
import { useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { Spinner } from '@/shared/ui/Controls';
import { MemberAvatar } from '../ui/MemberAvatar';
import type { ActivityItem } from './activityTypes';
import { MessageCard } from './MessageCard';
import type { IdentityResolver } from './MessageCard';
import { TaskCard } from './TaskCard';

/* D33 看板：横向泳道，一列一个成员；列体独立滚动，底部继续加载。 */

export interface BoardLane {
  slotId: string;
  name: string;
  /** 桌面成员 id：空状态的身份色只看它，保证看板和窗格同色。 */
  memberId?: string;
  /** 成员头像用的桌面 agent 标识；fallback 列没有。 */
  agentId?: string;
  isFallback?: boolean;
  /** Leader 的头像带王冠，和会话窗格一致。 */
  leader?: boolean;
  /** Phone snapshots are local; they do not use the core activity cursor. */
  local?: boolean;
  status?: string;
}

type Props = {
  lanes: BoardLane[];
  items: ActivityItem[];
  identity: IdentityResolver;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onOpenMember?: (memberId: string) => void;
  onOpenPhone?: (conversationId: string) => void;
  /** 一列都没有时的说明：新建团队和筛选后为空要说得不一样。 */
  emptyHint: { title: string; desc?: string };
  /** 空列的成员空状态；由上层注入，看板和会话窗格共用同一个组件。 */
  renderEmpty?: (lane: BoardLane) => ReactNode;
};

/** 滚到列底自动加载；没有 IntersectionObserver 时保留可点的「加载更多」。 */
function LoadMore({ onLoadMore }: { onLoadMore: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
    }, { root: el.closest('.team-board__body') });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onLoadMore]);
  return <button ref={ref} type="button" className="team-board__more" data-testid="activity-load-sentinel" onClick={onLoadMore}>加载更多</button>;
}

function Column({ lane, items, identity, hasMore, isLoadingMore, onLoadMore, renderEmpty, onOpenMember, onOpenPhone }: {
  lane: BoardLane; items: ActivityItem[]; identity: IdentityResolver; hasMore: boolean; isLoadingMore: boolean; onLoadMore: () => void; renderEmpty?: (lane: BoardLane) => ReactNode; onOpenMember?: (memberId: string) => void; onOpenPhone?: (conversationId: string) => void;
}) {
  const memberId = lane.memberId;
  const navigation = memberId && !lane.isFallback && onOpenMember
    ? { open: () => onOpenMember(memberId), label: `打开 ${lane.name} 的会话` } : undefined;
  return (
    <section className="team-board__col" data-testid="activity-board-column" data-lane-id={lane.slotId}>
      <header className="team-board__head">
        {lane.isFallback
          ? <span className="team-board__dot" aria-hidden="true" />
          : <MemberAvatar id={lane.agentId ?? ''} name={lane.name} size="sm" crown={lane.leader} />}
        <span className="team-board__title" title={lane.name}>{lane.name}</span>
        <span className="team-board__status">{lane.status}</span>
        <span className="team-board__count" title={`${items.length} 条活动`}>{items.length}</span>
      </header>
      <div className="team-board__body">
        {items.length === 0
          ? (renderEmpty ? renderEmpty(lane) : <p className="team-board__empty">还没有活动</p>)
          : items.map((item) => item.kind === 'phone'
            ? <PhoneActivityCard key={item.id} activity={item.phone} at={item.createdAt} navigation={onOpenPhone ? { open: () => onOpenPhone(item.phone.conversationId), label: `打开手机会话 ${item.phone.title}` } : undefined} />
            : item.kind === 'message'
            ? <MessageCard key={`message:${item.id}`} message={item.message} identity={identity} navigation={navigation} />
            : <TaskCard key={`task:${item.id}`} task={item.task} identity={identity} navigation={navigation} />)}
        {!lane.local && hasMore && items.length > 0 && <LoadMore onLoadMore={onLoadMore} />}
        {!lane.local && isLoadingMore && <div className="team-board__loading"><Spinner size={14} /></div>}
      </div>
    </section>
  );
}

export function ActivityBoard({ lanes, items, identity, hasMore, isLoadingMore, onLoadMore, emptyHint, renderEmpty, onOpenMember, onOpenPhone }: Props) {
  const byLane = useMemo(() => {
    const map = new Map<string, ActivityItem[]>();
    for (const lane of lanes) map.set(lane.slotId, []);
    for (const item of items) map.get(item.lane)?.push(item);
    return map;
  }, [lanes, items]);

  if (lanes.length === 0) {
    return (
      <div className="team-board team-board--empty" data-testid="activity-board">
        <div>
          <p className="team-board__hint">{emptyHint.title}</p>
          {emptyHint.desc && <p className="team-board__hint-sub">{emptyHint.desc}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="team-board" data-testid="activity-board">
      {lanes.map((lane) => (
        <Column
          key={lane.slotId}
          lane={lane}
          items={byLane.get(lane.slotId) ?? []}
          identity={identity}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={onLoadMore}
          renderEmpty={renderEmpty}
          onOpenMember={onOpenMember}
          onOpenPhone={onOpenPhone}
        />
      ))}
    </div>
  );
}
