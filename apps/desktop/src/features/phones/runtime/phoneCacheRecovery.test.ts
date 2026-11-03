import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { loadPhoneCache, savePhoneCache } from './phoneCache';
const key = 'lom.phone-cache.v1:cache-recovery';
beforeEach(() => {
  S.cloud = 'signed-out'; S.account = null; loadPhoneCache();
  localStorage.clear(); S.cloud = 'signed-in';
  S.account = { id: 'cache-recovery', name: 'Test', email: '' };
});
it.each(['{', 'null', '{"version":2,"convs":[]}', '{"version":1,"convs":[null]}', '{"version":1,"convs":[],"schedules":{}}'])('PHONE-CACHE-01 bad cache preserves login and can retry: %s', raw => {
  localStorage.setItem(key, raw);
  expect(() => loadPhoneCache()).not.toThrow();
  expect(S.cloud).toBe('signed-in'); expect(localStorage.getItem(key)).toBe(raw);
  localStorage.setItem(key, JSON.stringify({ version: 1, convs: [], souls: { dev_test: 'recovered' }, memories: {} }));
  loadPhoneCache(); expect(S.souls.dev_test).toBe('recovered');
});
it('PHONE-CACHE-01 save does not overwrite malformed recovery data', async () => {
  localStorage.setItem(key, '{');
  await expect(savePhoneCache()).rejects.toThrow(/缓存/);
  expect(localStorage.getItem(key)).toBe('{');
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => 'saved-session') }));
vi.mock('@/core/platform', () => ({ inShell: () => true }));
vi.mock('@/core/client', () => ({ api: vi.fn() }));
it('PHONE-CACHE-01 storage read failure permits same-account retry', () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => { throw new Error('blocked'); });
  expect(() => loadPhoneCache()).not.toThrow(); read.mockRestore();
  localStorage.setItem(key, JSON.stringify({ version: 1, convs: [], souls: { dev_test: 'retry' }, memories: {} }));
  loadPhoneCache(); expect(S.souls.dev_test).toBe('retry');
});
it('PHONE-CACHE-01 valid legacy cache can be saved with optional schedules absent', async () => {
  localStorage.setItem(key, JSON.stringify({ version: 1, convs: [], souls: { dev_test: 'valid' }, memories: {} }));
  loadPhoneCache(); await savePhoneCache();
  expect(JSON.parse(localStorage.getItem(key)!).souls.dev_test).toBe('valid');
});
