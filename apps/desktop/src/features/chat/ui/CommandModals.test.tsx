import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), list: vi.fn() }));
vi.mock('@/features/settings/runtime/lomMemory', () => ({ memoryDir: () => '/memory', listMemory: mocks.list, readMemory: mocks.read, writeMemory: mocks.write, addMemory: vi.fn() }));
vi.mock('@/shared/ui/Overlay', () => ({ Modal: ({ children, foot }: any) => <div>{children}{foot}</div> }));
vi.mock('@/shared/overlays/controller', () => ({ closeModal: vi.fn(), toast: vi.fn(), toastError: vi.fn(), confirm: vi.fn(), guardClose: vi.fn() }));
import { LomMemoryModal } from './CommandModals';
let host: HTMLDivElement, root: Root;
const click = async (label: string) => act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === label)!.click(); });
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.list.mockReset().mockResolvedValue([{ name: 'A.md', path: '/memory/A.md' }, { name: 'B.md', path: '/memory/B.md' }]); mocks.read.mockReset(); mocks.write.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<LomMemoryModal p={{ workspace: '/work' }} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('audit: stale A response cannot replace B or become saved content', async () => {
  const resolves: Record<string, (s: string) => void> = {};
  mocks.read.mockImplementation((path: string) => new Promise(resolve => { resolves[path] = resolve; }));
  await click('A.md'); await click('B.md');
  expect(host.querySelector('textarea')!.disabled).toBe(true);
  await act(async () => resolves['/memory/B.md']('B content'));
  await act(async () => resolves['/memory/A.md']('A content'));
  const area = host.querySelector('textarea')!;
  expect(area.getAttribute('aria-label')).toBe('编辑 B.md'); expect(area.value).toBe('B content');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, 'B edited');
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('保存');
  expect(mocks.write).toHaveBeenCalledWith('/memory/B.md', 'B edited', '/memory');
});
it('audit: read errors remain outside the disabled editor and cannot be saved', async () => {
  mocks.read.mockRejectedValue(new Error('denied')); await click('A.md');
  expect(host.textContent).toContain('读取失败：没有权限访问');
  expect(host.querySelector('textarea')!.value).toBe(''); expect(host.querySelector('textarea')!.disabled).toBe(true);
  await click('保存'); expect(mocks.write).not.toHaveBeenCalled();
});

it('review: editor and status occupy one right-hand grid cell; switching preserves drafts', async () => {
  mocks.read.mockResolvedValue('original'); await click('A.md');
  const area = host.querySelector('textarea')!;
  const grid = host.querySelector('[style*="grid-template-columns"]')!;
  expect(grid.children).toHaveLength(2); expect(grid.children[1].contains(area)).toBe(true);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, 'unsaved A');
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('B.md'); await click('A.md');
  expect(host.querySelector('textarea')!.value).toBe('unsaved A');
  await click('保存'); expect(mocks.write).toHaveBeenCalledWith('/memory/A.md', 'unsaved A', '/memory');
});
it('review: list failure ends loading and offers a working retry', async () => {
  await act(async () => root.unmount()); root = createRoot(host);
  mocks.list.mockRejectedValueOnce(new Error('offline'));
  await act(async () => root.render(<LomMemoryModal p={{ workspace: '/work' }} />));
  expect(host.textContent).toContain('读取失败：连接不上 Lom 服务'); expect(host.textContent).not.toContain('正在读取');
  await click('重试'); expect(host.textContent).toContain('A.md'); expect(host.querySelector('[role="alert"]')).toBeNull();
});
