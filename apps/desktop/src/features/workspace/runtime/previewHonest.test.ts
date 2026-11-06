import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';
const api = vi.hoisted(() => vi.fn());
vi.mock('@/core/client', () => ({ api, getEndpoint: () => ({ defaultFolder: '/work' }) }));
const { refreshPreview } = await import('./workspace');
const task: Conv = { id: 'a', owner: 'pc', title: 'a', updated: 0, remote: true, workspace: '/a', previewFile: '/a/index.html', messages: [] };
const page = '<link rel="stylesheet" href="s.css"><script src="app.js"></script><img src="logo.png"><h1>主页</h1>';
/** 按路径回放：ok 里有的成功，其余失败（带原因） */
const serve = (files: Record<string, string>) => api.mockImplementation(async (_m: string, route: string, body: { path: string }) => {
  if (body.path in files) return files[body.path];
  throw new Error(`读取失败 ${route} ${body.path}`);
});
beforeEach(() => {
  api.mockReset(); S.route = { name: 'chat' }; S.convs = [{ ...task }]; S.activeConv = 'a'; S.workspaceBrowseRoot = '';
  S.previewHtml = ''; S.previewError = ''; S.previewAt = 0; S.previewAssetFailures = []; S.previewAssetTotal = 0;
});

it('WS-PREVIEW-01 #401 a failed refresh keeps the old page but reports an error code and keeps the old time', async () => {
  serve({ '/a/index.html': '<h1>旧版本</h1>' });
  await refreshPreview();
  const firstAt = S.previewAt;
  expect(S.previewHtml).toContain('旧版本'); expect(S.previewError).toBe(''); expect(firstAt).toBeGreaterThan(0);
  serve({});
  await refreshPreview();
  expect(S.previewHtml).toContain('旧版本');
  expect(S.previewAt).toBe(firstAt);
  expect(S.previewError).toContain('workspace.preview_failed');
  expect(S.previewError).toContain('/a/index.html');
});

it('WS-PREVIEW-01 #401 the next successful refresh clears the error', async () => {
  serve({ '/a/index.html': '<h1>一</h1>' }); await refreshPreview();
  serve({}); await refreshPreview(); expect(S.previewError).not.toBe('');
  serve({ '/a/index.html': '<h1>二</h1>' }); await refreshPreview();
  expect(S.previewError).toBe(''); expect(S.previewHtml).toContain('二');
});

it('WS-PREVIEW-01 #409 failed local assets are recorded with path and reason, not only logged', async () => {
  serve({ '/a/index.html': page, '/a/s.css': 'h1{color:red}' });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await refreshPreview();
  warn.mockRestore();
  expect(S.previewAssetTotal).toBe(3);
  expect(S.previewAssetFailures.map(f => f.path).sort()).toEqual(['app.js', 'logo.png']);
  expect(S.previewAssetFailures[0].reason).toContain('读取失败');
  expect(S.previewHtml).toContain('color:red');
});

it('WS-PREVIEW-01 #409 when every asset succeeds there are no failures', async () => {
  serve({ '/a/index.html': page, '/a/s.css': 'h1{}', '/a/app.js': 'void 0', '/a/logo.png': 'data:image/png;base64,AA==' });
  await refreshPreview();
  expect(S.previewAssetTotal).toBe(3); expect(S.previewAssetFailures).toEqual([]);
});

it('WS-PREVIEW-01 #409 url() inside a linked stylesheet and video posters are inlined, and their failures are reported', async () => {
  serve({
    '/a/index.html': '<link rel="stylesheet" href="css/s.css"><video poster="p.png"></video><video poster="gone.png"></video>',
    '/a/css/s.css': 'body{background:url("bg.png")} i{background:url(missing.png)} b{background:url(data:image/png;base64,AA==)}',
    '/a/css/bg.png': 'data:image/png;base64,Qkc=', '/a/p.png': 'data:image/png;base64,UA==',
  });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await refreshPreview();
  warn.mockRestore();
  expect(S.previewHtml).toContain('data:image/png;base64,Qkc=');
  expect(S.previewHtml).toContain('data:image/png;base64,UA==');
  expect(S.previewAssetFailures.map(f => f.path).sort()).toEqual(['css/missing.png', 'gone.png']);
});

it('WS-PREVIEW-01 #409 relative media sources that cannot be inlined are listed as failures instead of silently missing', async () => {
  serve({ '/a/index.html': '<video><source src="clip.mp4"></video><audio src="a.mp3"></audio>' });
  await refreshPreview();
  expect(S.previewAssetFailures.map(f => f.path).sort()).toEqual(['a.mp3', 'clip.mp4']);
  expect(S.previewAssetFailures[0].reason).toContain('暂不支持');
});

it('WS-PREVIEW-01 #409 the failure list is cleared when another task replaces the preview', async () => {
  serve({ '/a/index.html': page });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await refreshPreview(); warn.mockRestore();
  expect(S.previewAssetFailures.length).toBe(3);
  S.convs[0].previewFile = undefined; await refreshPreview();
  expect(S.previewAssetFailures).toEqual([]); expect(S.previewAssetTotal).toBe(0);
});
