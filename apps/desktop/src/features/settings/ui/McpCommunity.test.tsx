import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
vi.hoisted(() => vi.stubEnv('VITE_LOM_CONNECTOR_URL', ''));
vi.mock('../runtime/mcpManager', async original => ({
  ...await original<typeof import('../runtime/mcpManager')>(),
  listMcp: vi.fn(async () => []),
}));
import { McpManager } from './McpModal';
import { Plugins } from '@/features/capabilities/ui/Plugins';

it('community MCP works without a hosted service and never advertises unconfigured connections', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<McpManager embedded />));
    expect(host.textContent).toContain('添加服务');
    expect(host.textContent).not.toContain('添加托管连接器');
    const add = [...host.querySelectorAll('button')].find(button => button.textContent === '添加服务')!;
    await act(async () => add.click());
    expect(host.querySelector('input[placeholder^="https://"]')).not.toBeNull();
    await act(async () => root.render(<Plugins />));
    expect(host.textContent).toContain('添加连接器');
    expect(host.textContent).not.toContain('精选连接器');
    expect(host.textContent).not.toContain('配置应用账号');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
