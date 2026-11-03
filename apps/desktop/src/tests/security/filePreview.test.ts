import { afterEach, expect, it, vi } from 'vitest';
import { loadFilePreview, setEndpoint } from '@/core/client';
afterEach(() => vi.unstubAllGlobals());
it('FILE-PREVIEW-01 uses header authentication and never embeds token in URL', async () => {
  setEndpoint({ url: 'http://core', token: 'secret-token', defaultFolder: '/work', homeDir: '/home' });
  const fetcher = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/png' } }));
  vi.stubGlobal('fetch', fetcher);
  const blob = await loadFilePreview('/work/a.png', new AbortController().signal);
  expect(blob.type).toBe('image/png'); expect(blob.size).toBe(2);
  expect(fetcher.mock.calls[0][0]).not.toContain('secret-token');
  expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { 'x-lom-token': 'secret-token' }, credentials: 'omit', referrerPolicy: 'no-referrer' });
});
it.each([['text/html', '2'], ['image/png', '99999999']])('FILE-PREVIEW-01 rejects unsafe MIME or oversized response %s', async (mime, size) => {
  setEndpoint({ url: 'http://core', token: 'secret', defaultFolder: '/', homeDir: '/' });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('xx', { headers: { 'content-type': mime, 'content-length': size } })));
  await expect(loadFilePreview('/a', new AbortController().signal)).rejects.toThrow();
});
