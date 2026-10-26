import { openConv } from '@/app/navigation';
import { buildPhoneActivity, phoneActivityLanes, teamPhoneConversations } from './phoneActivity';
import { useTeamPhones } from './useTeamPhones';
import { openTeamMember } from '../actions/teams';
import { useState } from 'react';
import type { Team } from '@/state/types';
import { S, update, useStore } from '@/state/store';
import { coreName } from '../runtime/coreTeam';
import { TeamEmptyState } from '../ui/TeamEmptyState';
import { ActivityBoard } from './ActivityBoard';
import type { BoardLane } from './ActivityBoard';
import { ActivityControls, defaultActivityControls } from './ActivityControls';
import type { ActivityControlsState } from './ActivityControls';
import { buildActivityItems, FALLBACK_LANE, filterActivityItems, laneColor, sortActivityItems } from './activityTypes';
import type { IdentityResolver } from './MessageCard';
import { useTeamActivityFeed } from './useTeamActivityFeed';

/* D33 团队活动看板：把内核团队的成员列、控制栏和活动流拼在一起。
 * 只读团队信箱和任务，不参与派活、权限或成员同步。 */

const FALLBACK_NAME = '未分配 / 外部';

/** 把建议填进这个成员的输入框；进入该成员会话后继续编辑。 */
export const fillTeamDraft = (teamId: string, memberId: string, text: string) => {
  const ckey = `team:${teamId}:${memberId}`;
  update((s) => { s.drafts[ckey] = text; s.focusNext = `composer:${ckey}`; });
};

function lanesOf(team: Team): BoardLane[] {
  const slots = team.core?.slots;
  if (!slots) return [];
  return team.members.flatMap((member) => {
    const slotId = slots[member.mid];
    return slotId ? [{ slotId, name: coreName(team, member), memberId: member.mid, agentId: member.agent, leader: !!member.leader }] : [];
  });
}

export function TeamActivityView({ team }: { team: Team }) {
  const state = useStore();
  useTeamPhones(team);
  const [controls, setControls] = useState<ActivityControlsState>(defaultActivityControls);

  // 状态树是原地修改的，team 对象引用不会变；这里每次渲染按当前的 core.slots 重新归列。
  const memberLanes = [...lanesOf(team), ...phoneActivityLanes(team, state)];
  const knownSlots = new Set(memberLanes.map((lane) => lane.slotId));
  const identity: IdentityResolver = {
    nameOf: (slotId) => memberLanes.find((lane) => lane.slotId === slotId)?.name ?? slotId.slice(0, 8),
    colorOf: laneColor,
  };

  const feed = useTeamActivityFeed(team.core?.id, !!team.core, controls.direction, controls.kind);

  const items = sortActivityItems([...buildActivityItems(feed.messages, feed.tasks, knownSlots, controls.direction), ...buildPhoneActivity(team, state)], controls.direction);
  const visible = filterActivityItems(items, {
    kind: controls.kind,
    members: new Set(controls.members),
    showSystemMessages: controls.showSystem,
    showFinishedTasks: controls.showFinished,
  });

  const selected = new Set(controls.members);
  const lanes = memberLanes.filter((lane) => selected.size === 0 || selected.has(lane.slotId));
  if (visible.some((item) => item.lane === FALLBACK_LANE) && (selected.size === 0 || selected.has(FALLBACK_LANE))) {
    lanes.push({ slotId: FALLBACK_LANE, name: FALLBACK_NAME, isFallback: true });
  }

  const memberOptions = memberLanes.map((lane) => ({ slotId: lane.slotId, name: lane.name }));
  const emptyHint = memberLanes.length === 0
    ? { title: '团队还没有开工', desc: '切换到成员会话告诉 Leader 目标，成员之间的消息和任务会按成员显示在这里。' }
    : { title: '没有符合筛选的活动' };

  return (
    <div className="team-activity" data-testid="team-activity-view">
      <ActivityControls value={controls} onChange={setControls} members={memberOptions} />

      {feed.error ? (
        <div className="team-activity__error" role="alert">
          <span>团队活动读取失败：{feed.error}</span>
          <button type="button" className="act-card__more" onClick={feed.retry}>重试</button>
        </div>
      ) : null}
      {/* 首次读取时还没有任何活动：显示读取中，不先闪一下「还没开工」的空状态；已有手机本机记录时直接显示看板 */}
      {feed.isLoading && items.length === 0 ? (
        <div className="team-activity__loading"><span className="spinner" aria-hidden="true" /> 正在读取团队活动…</div>
      ) : (
        <ActivityBoard
          lanes={lanes}
          items={visible}
          identity={identity}
          hasMore={feed.hasMore}
          isLoadingMore={feed.isLoadingMore}
          onLoadMore={feed.loadMore}
          onOpenMember={memberId => openTeamMember(team.id, memberId)}
          onOpenPhone={id => { const current = S.teams.find(t => t.id === team.id); if (current && teamPhoneConversations(current, S).some(c => c.id === id)) openConv(id); }}
          emptyHint={emptyHint}
          renderEmpty={(lane) => {
            if (lane.local) return <p className="team-board__empty">{lane.status === '离线' ? '手机离线，显示本机已同步记录' : '还没有本团队的手机活动'}</p>;
            const memberId = lane.memberId ?? lane.slotId;
            return (
              <TeamEmptyState
                compact
                member={{ name: lane.name, memberId, agentId: lane.agentId ?? '', leader: !!lane.leader }}
                onSuggest={lane.memberId ? (text) => fillTeamDraft(team.id, memberId, text) : undefined}
              />
            );
          }}
        />
      )}
    </div>
  );
}
