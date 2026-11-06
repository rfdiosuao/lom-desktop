import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ModalHost } from '@/app/overlays/ModalHost';
import { S } from '@/state/store';
const m = vi.hoisted(() => ({ list: vi.fn(), clear: vi.fn() }));
vi.mock('../runtime/mcpManager', async original => ({ ...await original<typeof import('../runtime/mcpManager')>(), listMcp: m.list }));
vi.mock('../runtime/mcpOAuth', () => ({ authorizeMcp: vi.fn(), clearMcpOAuth: m.clear, oauthEligible: () => true, oauthClearable: () => true }));
import { McpManager } from './McpModal';

const server = { id: 'docs', name: '文档服务', transport: { type: 'http', url: 'https://docs.example.test/mcp' }, enabled: true, builtin: false, last_test_status: 'connected' };
let host: HTMLElement, root: Root;
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)!;
const inDialog = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('[role=dialog] button')].find(b => b.textContent === text)!;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  S.modals.length = 0;
  m.list.mockResolvedValue([server]);
  m.clear.mockResolvedValue('本机凭据已清除');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<><McpManager embedded /><ModalHost /></>));
});
afterEach(() => { act(() => root.unmount()); host.remove(); S.modals.length = 0; });

it('SET-MCP-01 #438 clearing local authorization asks first and does nothing on cancel', async () => {
  await act(async () => button('清除本机授权').click());
  expect(m.clear).not.toHaveBeenCalled();
  expect(host.querySelector('[role=dialog]')?.textContent).toContain('重新授权');
  await act(async () => inDialog('取消').click());
  expect(m.clear).not.toHaveBeenCalled();
});

it('SET-MCP-01 #438 clears the local authorization only after confirmation', async () => {
  await act(async () => button('清除本机授权').click());
  await act(async () => inDialog('清除').click());
  expect(m.clear).toHaveBeenCalledTimes(1);
  expect(m.clear).toHaveBeenCalledWith(server);
});

it('SET-MCP-01 #438 shows a coded Chinese config error with the raw exception as detail', async () => {
  await act(async () => button('编辑').click());
  const address = host.querySelector<HTMLInputElement>('input[placeholder^="https://"]')!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(address, 'nope');
    address.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('保存').click());
  const alert = host.querySelector('[role=alert]')!;
  expect(alert.textContent).toContain('mcp.config_url');
  expect(alert.textContent).not.toMatch(/^Invalid URL/);
  expect(host.textContent).toContain('详情：');
  expect(host.textContent).toContain('Invalid URL');
});
