import { afterEach, expect, it, vi } from 'vitest';
import { cloud, cloudSkillArchive, restoreSession } from './cloud';
import { cloudConfigured, CLOUD_UNAVAILABLE } from './serviceConfig';
import { desktopUpdater, startUpdateChecks } from '@/features/updates/runtime/updater';
import { S } from '@/state/store';
afterEach(() => vi.unstubAllGlobals());
it('community build refuses every cloud request before fetch', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  expect(cloudConfigured()).toBe(false);
  await expect(cloud('GET', '/v1/account/me')).rejects.toThrow(CLOUD_UNAVAILABLE);
  await expect(cloudSkillArchive('example')).rejects.toThrow(CLOUD_UNAVAILABLE);
  expect(fetch).not.toHaveBeenCalled();
});
it('community session restoration never reuses a bundled service credential', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await restoreSession();
  expect(S.cloud).toBe('signed-out'); expect(S.account).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it('community updater never schedules or contacts an update server', async () => {
  const timer = vi.spyOn(window, 'setInterval');
  startUpdateChecks()();
  expect(timer).not.toHaveBeenCalled(); timer.mockRestore();
  await desktopUpdater.check();
  expect(desktopUpdater.snapshot().error).toContain('开源版未配置自动更新');
});
