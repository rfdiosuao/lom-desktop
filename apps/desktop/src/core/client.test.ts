import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, setEndpoint } from './client';
beforeEach(() => { vi.useFakeTimers(); setEndpoint({ url: 'http://core', token: 'startup', defaultFolder: '/work', homeDir: '/home/test' }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('D01 AC-5 aborts an unresponsive transport at its explicit deadline', async () => {
  const request = vi.fn((_url: string, _options: RequestInit) => new Promise<Response>(() => {})); vi.stubGlobal('fetch', request);
  const result = api('POST', '/api/conversations/task/cancel', { turn_id: 'current' }, { timeoutMs: 15000 });
  const failure = expect(result).rejects.toMatchObject({ code: 'LOM_CORE_CANCELLED' }); await vi.advanceTimersByTimeAsync(15000); await failure;
  expect(request.mock.calls[0][1].signal?.aborted).toBe(true);
});
it('D01 AC-5 bounds a response body that never finishes without changing ordinary requests', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: () => new Promise<string>(() => {}) })));
  const controller = new AbortController(); const result = api('GET', '/api/conversations/task', undefined, { signal: controller.signal });
  const failure = expect(result).rejects.toMatchObject({ code: 'LOM_CORE_CANCELLED' }); await vi.advanceTimersByTimeAsync(0); controller.abort(); await failure;
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { ok: true } })));
  expect(await api('GET', '/api/normal')).toEqual({ ok: true });
});
