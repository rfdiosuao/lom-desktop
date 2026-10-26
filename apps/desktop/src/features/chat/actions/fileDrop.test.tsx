import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import { installFileDrop } from './fileDrop';
import { Composer } from '../ui/Composer';

vi.mock('@/core/client', () => ({ uploadFile: vi.fn(async (_file: File, name: string) => `/uploads/${name}`) }));
const { uploadFile } = await import('@/core/client');
let cleanup: () => void;
let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function input(key: string) {
  const el = document.createElement('textarea');
  el.dataset.composer = key;
  document.body.append(el);
  return el;
}
function drag(target: EventTarget, files: File[], types = ['Files'], type = 'drop') {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types, files, items: [], dropEffect: 'none' } });
  target.dispatchEvent(event);
  return event;
}
const files = () => [
  new File(['png'], 'photo.png', { type: 'image/png' }),
  new File(['# hello'], 'notes.md', { type: 'text/markdown' }),
  new File(['hello'], 'notes.txt', { type: 'text/plain' }),
  new File(['video'], 'clip.mp4', { type: 'video/mp4' }),
];
beforeEach(() => {
  vi.mocked(uploadFile).mockClear();
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
  update(s => { s.mode = 'desktop'; s.attachments = {}; s.drafts.home = '未发送的草稿'; });
  cleanup = installFileDrop();
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  cleanup();
  document.body.replaceChildren();
});

it('窗口空白处混合拖入图片、MD、TXT、视频，阻止导航并进入附件区，不发送草稿', async () => {
  input('home');
  const url = location.href;
  expect(drag(document.body, [], ['Files'], 'dragover').defaultPrevented).toBe(true);
  expect(drag(document.body, files()).defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(S.attachments.home).toHaveLength(4));
  expect(S.attachments.home.map(a => a.name)).toEqual(files().map(f => f.name));
  expect(uploadFile).toHaveBeenCalledTimes(4);
  expect(S.attachments.home[0].preview).toBe('blob:preview');
  expect(S.drafts.home).toBe('未发送的草稿');
  expect(S.running).toEqual({});
  expect(location.href).toBe(url);
});

it('实际 React 输入框接收拖放一次，全局兜底不重复添加', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<Composer ckey="home" toolbar={false} />); });
  await act(async () => {
    expect(drag(host.querySelector('textarea')!, files()).defaultPrevented).toBe(true);
  });
  expect(S.attachments.home).toHaveLength(4);
  expect(uploadFile).toHaveBeenCalledTimes(4);
  expect(host.querySelectorAll('.composer__attachments .attach')).toHaveLength(4);
  expect(S.drafts.home).toBe('未发送的草稿');
});

it('多个聊天框按最后焦点接收，未选择时不猜目标', async () => {
  input('team:a');
  const b = input('team:b');
  expect(drag(document.body, files()).defaultPrevented).toBe(true);
  expect(S.attachments).toEqual({});
  b.focus();
  drag(document.body, files());
  expect(S.attachments['team:b']).toHaveLength(4);
  expect(S.attachments['team:a']).toBeUndefined();
});

it('离开之前的聊天或隐藏它后，不把附件写入旧会话', () => {
  const old = input('team:old'); old.focus(); old.hidden = true;
  input('team:new');
  drag(document.body, files());
  expect(S.attachments['team:new']).toHaveLength(4);
  expect(S.attachments['team:old']).toBeUndefined();
});

it('没有输入框或打开弹窗时仍阻止文件导航', () => {
  expect(drag(document.body, files()).defaultPrevented).toBe(true);
  input('home');
  const modal = document.createElement('div'); modal.setAttribute('role', 'dialog'); document.body.append(modal);
  expect(drag(document.body, files()).defaultPrevented).toBe(true);
  expect(S.attachments).toEqual({});
  expect(uploadFile).not.toHaveBeenCalled();
});

it('网页图片链接不导航，普通文字拖动不拦截；卸载移除监听', () => {
  input('home');
  expect(drag(document.body, [], ['text/uri-list']).defaultPrevented).toBe(true);
  expect(drag(document.body, [], ['text/plain']).defaultPrevented).toBe(false);
  expect(S.attachments).toEqual({});
  cleanup();
  expect(drag(document.body, files()).defaultPrevented).toBe(false);
});
