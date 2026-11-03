import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
const m = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), test: vi.fn() }));
vi.mock('../runtime/mcpBindings', () => ({ readAssistantMcp: m.read, saveAssistantMcp: m.save, testAssistantMcp: m.test }));
import { PersonalMcp } from './PersonalMcp';
const a = { id: 'pa_a', name: 'A', directory: '/a', workspace: '/a', conversation: 'chat' };
const data = { servers: [{ id: 'docs', name: 'Docs', enabled: true }, { id: 'mail', name: 'Mail', enabled: false }], selected: ['docs'], missing: [] };
let host: HTMLDivElement, root: Root;
const button = (text: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)!;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.resetAllMocks();
  S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' }; S.running = {};
  m.read.mockResolvedValue(data); m.save.mockResolvedValue(undefined); m.test.mockResolvedValue('连接成功，发现 1 个工具：search_docs');
  host = document.createElement('div'); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); });
it('MCP-02 AC6 loads real selection and saves the edited original assistant', async () => {
  await act(async () => root.render(<PersonalMcp assistant={a} />));
  const check = host.querySelector<HTMLButtonElement>('[aria-label="使用 Mail"]')!;
  expect(check.getAttribute('aria-checked')).toBe('false');
  await act(async () => check.click());
  await act(async () => button('保存服务选择').click());
  expect(m.save).toHaveBeenCalledWith(a, ['docs', 'mail']);
  expect(host.textContent).toContain('服务选择已更新');
});
it('MCP-02 AC6 failed reading is not an empty list and explicit retry works', async () => {
  m.read.mockRejectedValueOnce(new Error('offline'));
  await act(async () => root.render(<PersonalMcp assistant={a} />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('offline');
  expect(host.textContent).not.toContain('尚未添加外部');
  await act(async () => button('重新读取').click());
  expect(host.textContent).toContain('Docs');
});
it('MCP-02 AC6 waiting and failure have honest status; a failed save preserves edits', async () => {
  m.save.mockRejectedValue(new Error('更新未确认'));
  await act(async () => root.render(<PersonalMcp assistant={a} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="使用 Mail"]')!.click());
  await act(async () => button('保存服务选择').click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('未确认');
  expect(host.querySelector<HTMLButtonElement>('[aria-label="使用 Mail"]')?.getAttribute('aria-checked')).toBe('true');
  expect(host.textContent).not.toContain('服务选择已更新');
});
it('MCP-02 AC5 connection testing shows discovered tools without applying settings', async () => {
  await act(async () => root.render(<PersonalMcp assistant={a} />));
  await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === '测试连接')!.click());
  expect(host.textContent).toContain('search_docs'); expect(m.save).not.toHaveBeenCalled();
});
it('MCP-02 AC6 a previous assistant response cannot overwrite the new assistant', async () => {
  let resolve!: (value: typeof data) => void;
  m.read.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await act(async () => root.render(<PersonalMcp assistant={a} />));
  expect(host.textContent).toContain('正在读取');
  await act(async () => root.render(<PersonalMcp assistant={{ ...a, id: 'pa_b', conversation: 'b' }} />));
  await act(async () => resolve({ ...data, servers: [{ id: 'old', name: 'OLD', enabled: true }] }));
  expect(host.textContent).not.toContain('OLD'); expect(host.textContent).toContain('Docs');
});
