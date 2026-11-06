import type { Team } from '@/state/types';
import { leaderMember } from './team';

export type TeamMessageRoute =
  | { kind: 'direct'; memberId?: string }
  | { kind: 'group'; mention: { kind: 'members'; memberIds: string[] } | { kind: 'everyone' } };

export function resolveTeamRecipients(team: Team, route: TeamMessageRoute) {
  const find = (id: string) => {
    const member = team.members.find(candidate => candidate.mid === id);
    if (!member) throw new Error('指定成员不在这个团队里');
    return member;
  };
  if (route.kind === 'direct') {
    const member = route.memberId === undefined ? leaderMember(team) : find(route.memberId);
    if (!member) throw new Error('团队没有队长');
    return [member];
  }
  return route.mention.kind === 'everyone' ? [...team.members] : [...new Set(route.mention.memberIds)].map(find);
}
