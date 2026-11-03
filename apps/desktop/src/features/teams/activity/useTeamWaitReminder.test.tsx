import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const sound = vi.hoisted(() => vi.fn());
vi.mock('@/app/sound', () => ({ taskFinished: sound }));
import { S } from '@/state/store';
import { useTeamWaitReminder } from './useTeamWaitReminder';
function Reminder() { useTeamWaitReminder(); return null; }
it('TEAM-WAIT-01 background wait reminds once after 30 seconds and never completes a task', async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); sound.mockClear();
  const oldTeams = S.teams, oldConvs = S.convs;
  S.teams = [{ id: 'team', real: true, leaderConv: 'worker', memberConvs: {} }] as never;
  S.convs = [{ id: 'worker', messages: [{ id: 'confirm', type: 'question', status: 'pending', at: Date.now() }] }] as never;
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Reminder />));
  await act(async () => vi.advanceTimersByTime(29000)); expect(sound).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1000)); expect(sound).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTime(60000)); expect(sound).toHaveBeenCalledOnce();
  expect(S.convs[0].messages[0].status).toBe('pending');
  await act(async () => root.unmount()); S.teams = oldTeams; S.convs = oldConvs; vi.useRealTimers();
});
it('TEAM-WAIT-01 foreground at 30 seconds still reminds after moving to background at 31 seconds', async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); sound.mockClear();
  const oldTeams = S.teams, oldConvs = S.convs, oldRoute = S.route;
  S.route = { name: 'team', id: 'team' };
  S.teams = [{ id: 'team', real: true, leaderConv: 'worker', memberConvs: {} }] as never;
  S.convs = [{ id: 'worker', messages: [{ id: 'confirm', type: 'approval', status: 'pending', at: Date.now() }] }] as never;
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Reminder />));
    await act(async () => vi.advanceTimersByTime(30000)); expect(sound).not.toHaveBeenCalled();
    focus.mockReturnValue(false);
    await act(async () => vi.advanceTimersByTime(1000)); expect(sound).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTime(60000)); expect(sound).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount()); S.teams = oldTeams; S.convs = oldConvs; S.route = oldRoute;
    focus.mockRestore(); hidden.mockRestore(); vi.useRealTimers();
  }
});
it('TEAM-WAIT-01 a reminded unconfirmed result stays reminded while a newer pending action temporarily takes priority', async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); sound.mockClear();
  const oldTeams = S.teams, oldConvs = S.convs;
  S.teams = [{ id: 'team', real: true, leaderConv: 'worker', memberConvs: {} }] as never;
  S.convs = [{ id: 'worker', messages: [{ id: 'old', type: 'approval', status: 'unconfirmed', at: Date.now() - 30000 }] }] as never;
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Reminder />));
    await act(async () => vi.advanceTimersByTime(1000)); expect(sound).toHaveBeenCalledTimes(1);
    S.convs[0].messages.push({ id: 'new', type: 'question', status: 'pending', at: Date.now() - 30000 });
    await act(async () => vi.advanceTimersByTime(1000)); expect(sound).toHaveBeenCalledTimes(2);
    S.convs[0].messages[1].status = 'resolved';
    await act(async () => vi.advanceTimersByTime(31000)); expect(sound).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount()); S.teams = oldTeams; S.convs = oldConvs;
    focus.mockRestore(); vi.useRealTimers();
  }
});
