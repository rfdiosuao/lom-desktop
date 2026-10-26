import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';
const api = vi.hoisted(() => vi.fn());
vi.mock('@/core/client', () => ({ api, getEndpoint: () => ({ defaultFolder: '/work' }) }));
const { refreshPreview } = await import('./workspace');
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const task = (id: string): Conv => ({ id, owner: 'pc', title: id, updated: 0, remote: true, workspace: `/${id}`, previewFile: `/${id}/index.html`, messages: [] });
beforeEach(() => { api.mockReset(); S.route = { name: 'chat' }; S.convs = [task('a'), task('b')]; S.activeConv = 'a'; S.workspaceBrowseRoot = ''; S.previewHtml = ''; S.previewError = ''; });
it.each(['success', 'failure'])('D01 stale preview %s cannot overwrite another task', async outcome => {
  const old = deferred<string>(); api.mockReturnValueOnce(old.promise).mockResolvedValue('<h1>Current B</h1>'); const first = refreshPreview(); S.activeConv = 'b'; await refreshPreview();
  if (outcome === 'success') old.resolve('<h1>Old A</h1>'); else old.reject(new Error('Old A error'));
  await first; expect(S.previewHtml).toContain('Current B'); expect(S.previewError).toBe('');
});
it('D01 latest refresh for the same file wins over an older response', async () => {
  const old = deferred<string>(); api.mockReturnValueOnce(old.promise).mockResolvedValue('<h1>New file content</h1>'); const first = refreshPreview(); await refreshPreview(); old.resolve('<h1>Stale content</h1>'); await first;
  expect(S.previewHtml).toContain('New file content');
});
it('D01 switching to task without preview clears it and invalidates old reads', async () => {
  const old = deferred<string>(); api.mockReturnValueOnce(old.promise); const first = refreshPreview(); S.activeConv = 'b'; S.convs[1].previewFile = undefined; await refreshPreview(); old.resolve('<h1>Old A</h1>'); await first;
  expect(S.previewHtml).toBe(''); expect(S.previewError).toBe('');
});
it('D01 changing preview file invalidates old response before next refresh', async () => {
  const old = deferred<string>(); api.mockReturnValueOnce(old.promise); const first = refreshPreview(); S.convs[0].previewFile = '/a/other.html'; old.resolve('<h1>Old file</h1>'); await first; expect(S.previewHtml).toBe('');
});
it('D01 local assets retain original workspace when switching task during read', async () => {
  const old = deferred<string>(); api.mockReturnValueOnce(old.promise).mockResolvedValue('h1 { display: block }'); const first = refreshPreview(); S.activeConv = 'b'; old.resolve('<link rel="stylesheet" href="page.css"><h1>A</h1>'); await first;
  expect(api).toHaveBeenCalledWith('POST', '/api/fs/read', { path: '/a/page.css', workspace: '/a' }); expect(S.previewHtml).toBe('');
});
it('D01 same-account profile refresh keeps the current preview request valid', async () => {
  S.account = { id: 'same', email: 'same@example.test', name: 'Before' };
  const old = deferred<string>(); api.mockReturnValueOnce(old.promise); const first = refreshPreview();
  S.account = { ...S.account, name: 'After' }; old.resolve('<h1>Current preview</h1>'); await first;
  expect(S.previewHtml).toContain('Current preview');
});
