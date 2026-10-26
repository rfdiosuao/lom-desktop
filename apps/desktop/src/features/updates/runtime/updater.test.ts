import { expect, it, vi } from 'vitest';
import type { Update } from './updater';
import { createUpdater } from './updater';

function fixture() {
  const item = { version: '0.1.5', body: '更新说明', close: vi.fn().mockResolvedValue(undefined), download: vi.fn().mockResolvedValue(undefined), install: vi.fn().mockResolvedValue(undefined) };
  const check = vi.fn().mockResolvedValue(item as unknown as Update);
  const busy = vi.fn().mockReturnValue(false);
  const restart = vi.fn().mockResolvedValue(undefined);
  return { ...item, check, busy, restart, u: createUpdater({ check, busy, restart }) };
}
it('D25 checking announces a release without downloading or installing', async () => {
  const f = fixture(); await f.u.check();
  expect(f.u.snapshot()).toMatchObject({ phase: 'available', version: '0.1.5', notes: '更新说明' });
  expect(f.download).not.toHaveBeenCalled(); expect(f.install).not.toHaveBeenCalled();
});
it('D25 download progress waits for signature verification, then requires a separate install action', async () => {
  const f = fixture(); let finish!: () => void;
  f.download.mockImplementation(callback => { callback({ event: 'Started', data: { contentLength: 100 } }); callback({ event: 'Progress', data: { chunkLength: 75 } }); callback({event: 'Finished'}); return new Promise<void>(resolve => { finish = resolve; }); });
  await f.u.check(); const pending = f.u.download();
  expect(f.u.snapshot()).toMatchObject({ phase: 'downloading', received: 75, total: 100 });
  await f.u.install(); expect(f.install).not.toHaveBeenCalled();
  finish(); await pending;
  expect(f.u.snapshot().phase).toBe('ready'); expect(f.install).not.toHaveBeenCalled();
  await f.u.install(); expect(f.install).toHaveBeenCalledTimes(1); expect(f.restart).toHaveBeenCalledTimes(1);
});
it('D25 invalid signature or interrupted download cannot become installable and can retry', async () => {
  const f = fixture(); f.download.mockRejectedValueOnce(new Error('signature invalid'));
  await f.u.check(); await f.u.download(); await f.u.install();
  expect(f.u.snapshot()).toMatchObject({phase:'error',error:'signature invalid'}); expect(f.install).not.toHaveBeenCalled();
  await f.u.download(); expect(f.u.snapshot().phase).toBe('ready');
});
it('D25 running tasks block installation and preserve the verified download', async () => {
  const f = fixture(); await f.u.check(); await f.u.download(); f.busy.mockReturnValue(true);
  await f.u.install(); expect(f.install).not.toHaveBeenCalled(); expect(f.u.snapshot().phase).toBe('ready');
  f.busy.mockReturnValue(false); await f.u.install(); expect(f.install).toHaveBeenCalledTimes(1);
});
it('D25 deduplicates checking and never discards a ready update on another check', async () => {
  const f = fixture(); await Promise.all([f.u.check(),f.u.check()]); expect(f.check).toHaveBeenCalledTimes(1);
  await f.u.download(); await f.u.check(); expect(f.u.snapshot().phase).toBe('ready'); expect(f.check).toHaveBeenCalledTimes(1);
});
it('D25 check failures do not report up-to-date; no-update responses do', async () => {
  const f = fixture(); f.check.mockRejectedValueOnce(new Error('offline')); await f.u.check(); expect(f.u.snapshot().phase).toBe('error');
  f.check.mockResolvedValueOnce(null); await f.u.check(); expect(f.u.snapshot().phase).toBe('current');
});
it('D25 install failures do not restart the application', async () => {
  const f = fixture(); await f.u.check(); await f.u.download(); f.install.mockRejectedValueOnce(new Error('read-only install path'));
  await f.u.install(); expect(f.u.snapshot().phase).toBe('error'); expect(f.restart).not.toHaveBeenCalled();
});
