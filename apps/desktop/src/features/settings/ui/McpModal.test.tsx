import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ list: vi.fn(), authorize: vi.fn(), clear: vi.fn(), enable: vi.fn() }));
vi.mock('../runtime/mcpManager', async original => ({ ...await original<typeof import('../runtime/mcpManager')>(), listMcp: m.list, saveMcp: vi.fn(), changeMcp: vi.fn(), connectMcp: vi.fn(), enableDiscoveredMcp: m.enable, protectedMcp: (r: { builtin: boolean; name: string }) => r.builtin || r.name.startsWith('lom-phone-'), mcpStatusLabel: () => '尚未测试' }));
vi.mock('../runtime/mcpOAuth', () => ({ authorizeMcp: m.authorize, clearMcpOAuth: m.clear, oauthEligible: (r: { builtin: boolean }) => !r.builtin, oauthClearable: (r: { builtin: boolean }) => !r.builtin }));
import { McpManager } from './McpModal';
import { beginAuthChange } from '@/features/account/runtime/authScope';
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();m.list.mockResolvedValue([{id:'ap',name:'Activepieces',transport:{type:'http',url:'https://example.com/mcp'},enabled:false,builtin:false},{id:'bridge',name:'内部桥',builtin:true}]);
});
it('MCP-OAUTH-01 renders authorization, real completion notice and no auth action on internal bridges', async () => {
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<McpManager embedded />));
    const button = [...host.querySelectorAll('button')].filter(b => b.textContent === '授权连接');expect(button).toHaveLength(1);
    m.authorize.mockResolvedValue('授权已保存');
    m.enable.mockResolvedValue('已连接。新任务可以使用此连接器。');
    await act(async () => button[0].click());
    expect(host.querySelector('[role="status"]')?.textContent).toContain('新任务可以使用此连接器');
  } finally { await act(async () => root.unmount()); }
});
it('MCP-OAUTH-01 cancel aborts the pending attempt and unmount/account change never show late success', async () => {
  const host = document.createElement('div'), root = createRoot(host);let finish!: (s: string) => void;
  m.authorize.mockImplementation(async () => new Promise(r => {finish = r;}));
  await act(async () => root.render(<McpManager embedded />));
  await act(async () => [...host.querySelectorAll('button')].find(b=>b.textContent==='授权连接')!.click());
  expect(host.textContent).toContain('请在浏览器登录');
  await act(async () => [...host.querySelectorAll('button')].find(b=>b.textContent==='取消授权')!.click());
  expect(m.authorize.mock.calls[0][1].aborted).toBe(true);
  await act(async () => {beginAuthChange();finish('OLD SUCCESS');});
  expect(host.textContent).not.toContain('OLD SUCCESS');
  await act(async () => root.unmount());
});

it('HUB-UI-02 keeps internal phone and builtin services out of the MCP list', async () => {
  m.list.mockResolvedValue([
    { id: 'ap', name: 'Activepieces', transport: { type: 'http', url: 'https://example.com/mcp' }, enabled: true, builtin: false },
    { id: 'phone', name: 'lom-phone-5a1f', transport: { type: 'http', url: 'https://phone.invalid/mcp' }, enabled: true, builtin: false },
    { id: 'bridge', name: '内部桥', builtin: true },
  ]);
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<McpManager embedded />));
    expect([...host.querySelectorAll('.card')]).toHaveLength(1);
    expect(host.textContent).toContain('Activepieces');
    expect(host.textContent).not.toContain('lom-phone-5a1f');
    expect(host.textContent).not.toContain('内部桥');
    expect([...host.querySelectorAll('button')].map(b => b.textContent)).toEqual(expect.arrayContaining(['编辑', '删除']));
  } finally { await act(async () => root.unmount()); }
});
