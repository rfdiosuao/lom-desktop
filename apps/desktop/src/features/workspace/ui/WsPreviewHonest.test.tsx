import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
const api = vi.hoisted(() => vi.fn());
vi.mock('@/core/client', () => ({ api, getEndpoint: () => ({ defaultFolder: '/work' }) }));
const { Workspace } = await import('./Workspace');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const at = new Date('2026-11-06T08:30:00').getTime();
beforeEach(async () => {
  api.mockReset();
  S.route = { name: 'chat' }; S.activeConv = 'a'; S.wsTab = 'preview';
  S.convs = [{ id: 'a', owner: 'pc', title: 'a', updated: 0, remote: true, workspace: '/a', previewFile: '/a/index.html', preview: 'ready', messages: [] }];
  S.previewHtml = '<h1>旧页面</h1>'; S.previewAt = at; S.previewError = ''; S.previewAssetFailures = []; S.previewAssetTotal = 0;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Workspace />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const text = () => host.textContent || '';
const rerender = async (fn: () => void) => { fn(); await act(async () => root.render(<Workspace key={Math.random()} />)); };

it('WS-PREVIEW-01 #401 a good preview says 已更新 and shows no error notice', () => {
  expect(text()).toContain('已更新'); expect(host.querySelector('[role="alert"]')).toBeNull();
});

it('WS-PREVIEW-01 #401 after a failed refresh the status no longer says 已更新, names the old time, the error code and offers retry', async () => {
  await rerender(() => { S.previewError = '预览刷新失败：找不到 /a/index.html（workspace.preview_failed）'; });
  expect(text()).not.toContain('已更新');
  const alert = host.querySelector('[role="alert"]')?.textContent || '';
  expect(alert).toContain('刷新失败'); expect(alert).toContain('08:30'); expect(alert).toContain('旧内容'); expect(alert).toContain('workspace.preview_failed');
  expect([...host.querySelectorAll('button')].some(b => b.textContent?.includes('重试'))).toBe(true);
});

it('WS-PREVIEW-01 #401 retry re-reads the file and the notice disappears when it works', async () => {
  api.mockResolvedValue('<h1>新页面</h1>');
  await rerender(() => { S.previewError = '预览刷新失败：x（workspace.preview_failed）'; });
  const retry = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('重试'))!;
  await act(async () => { retry.click(); });
  expect(S.previewError).toBe(''); expect(host.querySelector('[role="alert"]')).toBeNull(); expect(text()).toContain('已更新');
});

it('WS-PREVIEW-01 #409 partial asset failures list path and reason above the preview', async () => {
  await rerender(() => { S.previewAssetTotal = 3; S.previewAssetFailures = [{ path: 'app.js', reason: '读取失败 A' }, { path: 'logo.png', reason: '读取失败 B' }]; });
  const note = host.querySelector('[role="status"].preview-notice')?.textContent || '';
  expect(note).toContain('2 个资源没能加载'); expect(note).toContain('共 3 个');
  expect(note).toContain('app.js'); expect(note).toContain('读取失败 A'); expect(note).toContain('logo.png');
  expect(note).not.toContain('全部');
});

it('WS-PREVIEW-01 #409 when every asset failed the notice says so', async () => {
  await rerender(() => { S.previewAssetTotal = 1; S.previewAssetFailures = [{ path: 'style.css', reason: '读取失败' }]; });
  expect(host.querySelector('.preview-notice')?.textContent).toContain('全部 1 个资源都没能加载');
});

it('WS-PREVIEW-01 #409 a long failure list is capped with a remainder count', async () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ path: `f${i}.png`, reason: '读取失败' }));
  await rerender(() => { S.previewAssetTotal = 10; S.previewAssetFailures = many; });
  const note = host.querySelector('.preview-notice')?.textContent || '';
  expect(host.querySelectorAll('.preview-notice li').length).toBe(5); expect(note).toContain('另有 3 个');
});
