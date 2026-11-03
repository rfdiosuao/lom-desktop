import { memberRuntimeLabel } from './memberWait';
import { MemberWait } from '../ui/MemberWait';
import { conversationOf } from '../runtime/team';
import { openConv } from '@/app/navigation';
import { buildPhoneActivity, teamPhoneConversations } from './phoneActivity';
import { useTeamPhones } from './useTeamPhones';
import { fillTeamDraft, openTeamMember, talkToLeader } from '../actions/teams';
import { useState } from 'react';
import type { Team } from '@/state/types';
import { S, useStore } from '@/state/store';
import { coreName } from '../runtime/coreTeam';
import { TeamEmptyState } from '../ui/TeamEmptyState';
import { ActivityBoard } from './ActivityBoard';
import { boardMemberLanes } from './memberLanes';
import { ActivityControls, defaultActivityControls } from './ActivityControls';
import type { ActivityControlsState } from './ActivityControls';
import { buildActivityItems, FALLBACK_LANE, filterActivityItems, laneColor, sortActivityItems } from './activityTypes';
import type { IdentityResolver } from './MessageCard';
import { useTeamActivityFeed } from './useTeamActivityFeed';

/* D33 团队活动看板：把内核团队的成员列、控制栏和活动流拼在一起。
 * 只读团队信箱和任务，不参与派活、权限或成员同步。 */

const FALLBACK_NAME = '未分配 / 外部';

/** focusMemberId：顶栏选中的成员，看板上它的一列带选中标记（TEAM-FOCUS-01）。 */
export function TeamActivityView({ team, focusMemberId }: { team: Team; focusMemberId?: string }) {
  const state = useStore();
  useTeamPhones(team);
  const [controls, setControls] = useState<ActivityControlsState>(defaultActivityControls);

  // 状态树是原地修改的，team 对象引用不会变；这里每次渲染按当前的 core.slots 重新归列，顺序跟团队成员一致。
  const memberLanes = boardMemberLanes(team, state).map(lane => {
    if (lane.local) return lane;
    const member = team.members.find(m => m.mid === lane.memberId);
    const c = member ? conversationOf(team, member) : undefined;
    return { ...lane, status: memberRuntimeLabel(c, !!c && !!state.running[c.id]) };
  });
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
  // TEAM-FOCUS-01：看板里没有输入框，空状态直接给出和 Leader 说目标的入口
  const emptyHint = memberLanes.length === 0
    ? { title: '团队还没有开工', desc: '告诉 Leader 你的目标后，成员之间的消息和任务会按成员显示在这里。', action: { label: '和 Leader 说目标', onClick: () => talkToLeader(team.id) } }
    : { title: '没有符合筛选的活动' };

  return (
    <div className="team-activity" data-testid="team-activity-view">
      {team.members.map(member => <MemberWait key={member.mid} c={conversationOf(team, member)} name={coreName(team, member)} />)}
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
          focusMemberId={focusMemberId}
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
