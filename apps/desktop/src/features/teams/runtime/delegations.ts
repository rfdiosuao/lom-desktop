import { S } from '@/state/store';
/** Exact parents for new tasks; legacy OPC panes remain stoppable after upgrading. */
export function delegatedTasks(parent: string) {
  const team = S.teams.find(t => t.leaderConv === parent);
  return S.convs.filter(c => c.id !== parent && (c.parentTask === parent ||
    (!c.parentTask && !!team && (c.teamId === team.id || Object.values(team.memberConvs || {}).includes(c.id)))));
}
