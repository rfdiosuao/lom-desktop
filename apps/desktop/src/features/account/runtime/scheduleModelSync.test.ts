import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
const reconcile = vi.hoisted(() => vi.fn());
vi.mock('./modelReconcile', () => ({ reconcileSchedules: reconcile }));
const { syncScheduleModels } = await import('./scheduleModelSync');
const models = { pro: 'deepseek', max: 'max', mini: 'mini' };
beforeEach(() => { reconcile.mockReset(); S.cloudScheduleError = ''; S.cloudError = ''; });
it('MODEL-SYNC-01 rejects stale maintenance results after an account or revision change', async () => {
  let finish!: (issues: unknown[]) => void, current = true;
  reconcile.mockImplementation(() => new Promise(r => { finish = r; }));
  syncScheduleModels('cloud', models, {}, () => current);
  current = false; finish([{ id: 'old', reason: 'model_unknown' }]);
  await new Promise(r => setTimeout(r, 0));
  expect(S.cloudScheduleError).toBe(''); expect(S.cloudError).toBe('');
});
it('MODEL-SYNC-01 maintains one worker and runs only the latest queued mapping', async () => {
  let finish!: (issues: unknown[]) => void;
  reconcile.mockImplementationOnce(() => new Promise(r => { finish = r; })).mockResolvedValue([]);
  syncScheduleModels('first', models, {}, () => true);
  syncScheduleModels('obsolete', models, {}, () => true);
  syncScheduleModels('latest', models, {}, () => true);
  expect(reconcile).toHaveBeenCalledTimes(1);
  finish([{ id: 'bad', reason: 'update_failed' }]);
  await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(2));
  expect(reconcile.mock.calls[1][0]).toBe('latest');
  expect(S.cloudScheduleError).toBe(''); expect(S.cloudError).toBe('');
});
it('MODEL-SYNC-01 exposes cron failures independently without raw internal details', async () => {
  reconcile.mockRejectedValue(new Error('private-path secret-field'));
  syncScheduleModels('cloud', models, {}, () => true);
  await vi.waitFor(() => expect(S.cloudScheduleError).toContain('定时任务模型同步未完成'));
  expect(S.cloudScheduleError).not.toContain('private-path');
  expect(S.cloudError).toBe('');
});
