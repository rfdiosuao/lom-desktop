import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), copy: vi.fn() }));
vi.mock('@/features/chat/runtime/replyImages', () => ({ loadReplyImage: m.load, saveReplyImage: m.save, copyReplyImage: m.copy }));
import { ReplyImage } from './ReplyImage';

const menuItem = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.reply-image__menu button')].find(b => b.textContent === label);
const rightClick = (el: Element) => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));

it('D08 图片：左键看大图；右键像普通图片一样出现「复制图片 / 下载图片」，保存失败不显示成功', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  m.load.mockResolvedValue({ data: 'data:image/png;base64,abc', name: 'a.png' }); m.save.mockRejectedValue(new Error('disk full'));
  await act(async () => { root.render(<ReplyImage source="a.png" alt="海报" context={{ account: 'a', conversation: 'c', message: 'm' }} />); });
  expect(host.querySelector('img')?.alt).toBe('海报');
  // 小图下面不再有「右键复制」提示和下载按钮；右键不会直接复制，而是出菜单
  expect(host.textContent).not.toContain('下载图片');
  await act(async () => { rightClick(host.querySelector('img')!); });
  expect(m.copy).not.toHaveBeenCalled();
  await act(async () => { menuItem('复制图片')!.click(); });
  expect(m.copy).toHaveBeenCalled(); expect(host.textContent).toContain('已复制图片');
  // 左键打开大图，大图上右键下载
  await act(async () => { host.querySelector('button')!.click(); });
  expect(document.querySelector('dialog[open]')).not.toBeNull();
  await act(async () => { rightClick(document.querySelector('dialog img')!); });
  await act(async () => { menuItem('下载图片')!.click(); });
  expect(document.querySelector('dialog')!.textContent).toContain('保存失败');
  expect(document.querySelector('dialog')!.textContent).not.toContain('已保存');
  await act(async () => { document.querySelector<HTMLButtonElement>('dialog .reply-image__close')!.click(); });
  expect(document.querySelector('dialog')).toBeNull();
  act(() => root.unmount()); host.remove();
});
