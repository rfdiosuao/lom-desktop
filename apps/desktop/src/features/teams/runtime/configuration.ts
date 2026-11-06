import { workspaceRequired } from '@/features/workspace/runtime/required';
import { S, update } from '@/state/store';
import type { Team } from '@/state/types';
import { uid } from '@/shared/lib/util';

/** Shared UI/PA configuration creation; execution is deliberately a separate operation. */
export function createTeamConfiguration(input: Pick<Team, 'name' | 'folder' | 'members' | 'real'>): Team {
  // WS-REQUIRED-01：真实团队必须有明确的工作区，不落到不明目录
  if (input.real && !input.folder?.trim()) throw workspaceRequired('团队');
  const t: Team = { ...input, ownerAccountId: S.account?.id, id: uid('t'), created: Date.now(), panes: {} };
  update(s => { s.teams.unshift(t); });
  return t;
}
