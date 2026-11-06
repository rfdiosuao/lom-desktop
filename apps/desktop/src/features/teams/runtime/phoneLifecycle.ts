import { authAccount } from '@/features/account/runtime/authScope';
import { S } from '@/state/store';
import type { Team } from '@/state/types';
import { assertTeamCurrent } from './teamGuard';

const admissions = new WeakMap<Team, Set<Promise<unknown>>>();
export function trackTeamPhoneSend<T>(team: Team, work: Promise<T>): Promise<T> {
  const pending = admissions.get(team) ?? new Set<Promise<unknown>>();
  admissions.set(team, pending); pending.add(work);
  return work.finally(() => { pending.delete(work); });
}
export const teamPhoneConversations = (team: Team) => S.convs.filter(c => !c.remote && c.owner !== 'pc'
  && (c.teamId === team.id || Object.values(team.memberConvs || {}).includes(c.id)));

export async function stopTeamPhones(team: Team, current: () => boolean) {
  const authenticated = authAccount(), live = () => authenticated() && current() && S.teams.includes(team);
  // Stop invalidates admission guards first; wait for accepted or uncertain sends before inspecting children.
  await Promise.allSettled([...(admissions.get(team) ?? [])]);
  assertTeamCurrent(live);
  const { stopPhoneChild } = await import('@/features/phones/runtime/phoneCommander');
  const results = await Promise.allSettled(teamPhoneConversations(team).map(c => {
    assertTeamCurrent(live); return stopPhoneChild(c);
  }));
  assertTeamCurrent(live);
  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed) throw new Error(`${failed} 台手机尚未确认停止，可以重试或打开手机会话检查`);
  return results.filter(r => r.status === 'fulfilled' && r.value).length;
}
