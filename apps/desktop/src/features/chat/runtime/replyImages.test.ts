import { beforeEach, expect, it, vi } from 'vitest';
// @ts-expect-error Node provides WebCrypto in the test runner; app types are browser-only.
import { webcrypto } from 'node:crypto';
const m = vi.hoisted(() => ({ invoke: vi.fn(), api: vi.fn(), rpc: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: m.save }));
vi.mock('@/core/client', () => ({ api: m.api }));
vi.mock('@/features/phones/runtime/phoneRpc', () => ({ phoneRpc: m.rpc }));
import { loadReplyImage, saveReplyImage } from './replyImages';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII=';
const context = { account: 'a', conversation: 'c', message: 'm', workspace: '/work' };
let cache: Map<string, string>;
beforeEach(() => {
  vi.clearAllMocks(); Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  cache = new Map(); m.invoke.mockImplementation(async (cmd, { request }) => {
    if (cmd === 'reply_image_read') return cache.get(request.key) || null;
    if (cmd === 'reply_image_store') cache.set(request.key, request.data);
  }); m.api.mockResolvedValue(png);
});
it('D08 本地图片按会话工作目录解析，重载后原图删除仍从持久缓存恢复', async () => {
  const first = await loadReplyImage('图片 a.png', context);
  expect(m.api).toHaveBeenCalledWith('POST', '/api/fs/image-base64', { path: '/work/图片 a.png', workspace: '/work' });
  m.api.mockRejectedValue(new Error('file missing'));
  expect((await loadReplyImage('图片 a.png', { ...context })).data).toBe(first.data);
  expect(m.api).toHaveBeenCalledTimes(1);
  await expect(loadReplyImage('图片 a.png', { ...context, account: 'other' })).rejects.toThrow('file missing');
});
it('D08 缓存写入失败明确提示，保存取消不报告成功', async () => {
  m.invoke.mockImplementation(async cmd => { if (cmd === 'reply_image_store') throw new Error('disk full'); return null; });
  const image = await loadReplyImage('/work/a.png', context);
  expect(image.warning).toContain('未保存'); m.save.mockResolvedValue(null);
  expect(await saveReplyImage(image)).toBe(false);
});
it('D08 手机图片使用加密分片和摘要验证，错误摘要不能展示', async () => {
  const data = png.split(',')[1];
  m.rpc.mockImplementation(async (_device, method) => method === 'chat.image' ? { id: 'id', size: String(atob(data).length), sha256: 'wrong' } : { data, next: String(atob(data).length) });
  await expect(loadReplyImage('minis://workspace/a.png', { ...context, phone: { device: 'd', session: 's' } })).rejects.toThrow('完整性');
  expect(m.rpc).toHaveBeenCalledWith('d', 'chat.image', { session_id: 's', source: 'minis://workspace/a.png' });
});
it('D08 HTTPS 图片匿名读取且不发送来源，缓存后不再访问临时URL', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, url: 'https://images.example/a.png', headers: new Headers(), body: new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.from(atob(png.split(',')[1]), c => c.charCodeAt(0))); controller.close(); } }) } as Response);
  await loadReplyImage('https://images.example/a.png', context);
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
  await loadReplyImage('https://images.example/a.png', context); expect(fetchMock).toHaveBeenCalledTimes(1); fetchMock.mockRestore();
});
it('D08 手机图片分片成功后缓存，手机离线仍恢复；保存写入成功才返回成功', async () => {
  const data = png.split(',')[1], bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  m.rpc.mockImplementation(async (_device, method, p) => {
    if (method === 'chat.image') return { id: 'id', size: String(bytes.length), sha256 };
    const offset = Number(p.offset), next = Math.min(offset + 23, bytes.length);
    return { data: btoa(String.fromCharCode(...bytes.slice(offset, next))), next: String(next) };
  });
  const ctx = { ...context, phone: { device: 'd', session: 's' } };
  const first = await loadReplyImage('minis://workspace/a.png', ctx);
  expect(first.data).toBe(png);
  m.rpc.mockRejectedValue(new Error('offline'));
  expect((await loadReplyImage('minis://workspace/a.png', ctx)).data).toBe(png);
  m.save.mockResolvedValue('/downloads/a.png');
  expect(await saveReplyImage(first)).toBe(true);
  expect(m.invoke).toHaveBeenCalledWith('local_file_save', { path: '/downloads/a.png', data, sha256 });
});
