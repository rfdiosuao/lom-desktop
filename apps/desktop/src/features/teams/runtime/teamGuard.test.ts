import { expect, it, vi } from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('@/core/client', () => ({ api: request }));
import { teamRequest, observedTeamRun } from './teamGuard';
it('PA-TOOLS-02 F shared team requests reject stopped callers before HTTP and after a delayed response', async () => {
  await expect(teamRequest(() => false, 'POST', '/unused')).rejects.toThrow('已停止'); expect(request).not.toHaveBeenCalled();
  let live = true, resume!: () => void;
  request.mockImplementation(() => new Promise<void>(r => { resume = r; }));
  const pending = teamRequest(() => live, 'POST', '/created');
  live = false; resume(); await expect(pending).rejects.toThrow('已停止');
});

it('PA-TOOLS-02 D/E malformed run states and empty IDs are unknown for both read and stop', () => {
  for (const state of [null, {}, { active_run: {} }, { active_run: { team_run_id: '' } }, { active_run: { team_run_id: '  ' } }]) expect(() => observedTeamRun(state)).toThrow('状态不完整');
  expect(observedTeamRun({ active_run: null })).toBe(null);
  expect(observedTeamRun({ active_run: { team_run_id: 'run' } })).toBe('run');
});
