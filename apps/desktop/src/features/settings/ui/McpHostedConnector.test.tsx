import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ list: vi.fn() }));
vi.hoisted(() => vi.stubEnv('VITE_LOM_CONNECTOR_URL', 'https://connectors.example.invalid/mcp'));
vi.mock('../runtime/mcpManager', async original => ({ ...await original<typeof import('../runtime/mcpManager')>(), listMcp: m.list }));
import { hostedMcp } from '../runtime/mcpManager';
import { McpManager } from './McpModal';

let host: HTMLElement, root: Root;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  m.list.mockResolvedValue([]);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<McpManager embedded />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it('SET-MCP-01 #428 names the real service and domain instead of claiming it is a Lom-deployed service', () => {
  const panel = host.querySelector('.integration-panel')!;
  expect(panel.textContent).toContain('Activepieces');
  expect(panel.textContent).toContain(new URL(hostedMcp.url).hostname);
  expect(panel.textContent).toContain('授权');
  expect(panel.textContent).not.toContain('使用麓鸣部署的服务');
});

it('SET-MCP-01 #428 the address shown is the address that gets prefilled', async () => {
  const add = [...host.querySelectorAll('button')].find(b => b.textContent === '添加托管连接器')!;
  await act(async () => add.click());
  expect(host.querySelector<HTMLInputElement>('input[placeholder^="https://"]')!.value).toBe(hostedMcp.url);
});
