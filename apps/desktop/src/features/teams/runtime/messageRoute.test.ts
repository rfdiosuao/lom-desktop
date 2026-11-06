import { expect, it } from 'vitest';
import type { Team } from '@/state/types';
import { resolveTeamRecipients } from './messageRoute';

it('PA-TEAM-01 validates and deduplicates future group mentions against the current team', () => {
  const members = [{ mid: 'first', agent: 'pc', role: '队长', leader: true }, { mid: 'second', agent: 'ag:second', role: '成员' }];
  const team = { members } as Team;
  expect(resolveTeamRecipients(team, { kind: 'group', mention: { kind: 'everyone' } })).toEqual(members);
  expect(resolveTeamRecipients(team, { kind: 'group', mention: { kind: 'members', memberIds: ['second', 'second'] } })).toEqual([members[1]]);
  expect(() => resolveTeamRecipients(team, { kind: 'group', mention: { kind: 'members', memberIds: ['foreign'] } })).toThrow('不在这个团队里');
});
