import type { AppState } from '@/state/state';
import type { Team } from '@/state/types';
import { isLegacyLeaderAlias } from '../runtime/team';
import { coreName } from '../runtime/coreTeam';
import type { BoardLane } from './ActivityBoard';
import { phoneActivityLanes } from './phoneActivity';

/* TEAM-FOCUS-01 看板成员列：内核成员列和手机列按团队成员顺序排列，和顶栏成员标签一一对应。 */

function coreLanes(team: Team): BoardLane[] {
  const slots = team.core?.slots;
  if (!slots) return [];
  return team.members.flatMap((member) => {
    const slotId = slots[member.mid];
    return slotId ? [{ slotId, name: coreName(team, member), memberId: member.mid, agentId: member.agent, leader: !!member.leader }] : [];
  });
}

/** 看板上的成员列（不含「未分配 / 外部」），顺序与 team.members 一致。 */
export function boardMemberLanes(team: Team, state: AppState): BoardLane[] {
  const order = new Map(team.members.map((member, index) => [member.mid, index]));
  const rank = (lane: BoardLane) => order.get(lane.memberId ?? '') ?? team.members.length;
  return [...coreLanes(team), ...phoneActivityLanes(team, state)].sort((a, b) => rank(a) - rank(b));
}

/** 顶栏选中的成员在看板上没有列时说明原因：只说能确定的，不猜。 */
export function memberLaneNotice(team: Team, memberId: string, state: AppState): string {
  const member = team.members.find((m) => m.mid === memberId);
  if (member && isLegacyLeaderAlias(team, member)) return '这位成员与 Leader 共用会话，活动显示在 Leader 一列';
  if (boardMemberLanes(team, state).some((lane) => lane.memberId === memberId)) return '看板正在读取或已按成员筛选，暂时看不到这位成员的一列';
  if (member && state.agents[member.agent]?.kind === 'phone') return team.real ? '登录后，手机成员才会出现在看板上' : '示例手机不会出现在看板上';
  return '这位成员开工后才会出现在看板上';
}
