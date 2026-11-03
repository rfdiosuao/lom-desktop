import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';
import { beginAuthChange } from '@/features/account/runtime/authScope';
import { loadAssistants, storeAssistant, type PersonalAssistant } from '@/features/personal/runtime/catalog';
const m = vi.hoisted(() => ({ api: vi.fn(), mode: vi.fn() }));
vi.mock('@/core/client', async load => ({ ...await load<typeof import('@/core/client')>(), api: m.api }));
vi.mock('@/features/personal/runtime/permissions', () => ({ personalCoreMode: m.mode }));
import { readAssistantMcp, saveAssistantMcp, mcpBindingBlocker } from '@/features/personal/runtime/mcpBindings';
let a: PersonalAssistant, c: Conv, selected: string[];
const servers = [
  { id: 'docs', name: 'Docs', enabled: true, builtin: false },
  { id: 'mail', name: 'Mail', enabled: false, builtin: false },
  { id: 'bridge', name: 'lom-phone-pa-local', enabled: false, builtin: false },
  { id: 'other', name: 'lom-phone-other', enabled: false, builtin: false },
];
function row() { return { id: 'chat', type: 'aionrs', extra: { lom_personal: 'pa_a', lom_personal_directory: '/a', lom_personal_scope: 'pa-local', mcp_server_ids: [...selected] }, runtime: { has_task: true, is_processing: false } }; }
beforeEach(() => {
  beginAuthChange(); vi.resetAllMocks(); localStorage.clear();
  S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' }; S.running = {};
  a = { id: 'pa_a', name: 'A', directory: '/a', workspace: '/a', conversation: 'chat', permission: 'full' };
  c = { id: 'chat', owner: 'pc', title: 'A', updated: 1, messages: [], personal: { id: a.id, name: 'A', directory: a.directory }, personalScope: 'pa-local' } as Conv;
  S.convs = [c]; storeAssistant(a); selected = ['docs', 'bridge'];
  m.mode.mockReturnValue('yolo');
  m.api.mockImplementation(async (method: string, path: string, body?: { extra: { selected_mcp_server_ids: string[] } }) => {
    if (path === '/api/mcp/servers') return servers;
    if (method === 'PATCH') { selected = body!.extra.selected_mcp_server_ids; return row(); }
    if (method === 'GET') return row();
    return {};
  });
});
it('MCP-02 AC1 reads actual selection without exposing private transports', async () => {
  const data = await readAssistantMcp(a);
  expect(data.selected).toEqual(['docs']); expect(data.servers.map(x => x.id)).toEqual(['docs', 'mail']);
  expect(data.servers[0]).not.toHaveProperty('transport');
});
it('MCP-02 AC2 reselects original conversation, preserves own bridge and restores permission', async () => {
  await saveAssistantMcp(a, ['mail']);
  expect(m.api).toHaveBeenCalledWith('PATCH', '/api/conversations/chat', { extra: { selected_mcp_server_ids: ['mail', 'bridge'] } }, expect.any(Object));
  expect(m.api).toHaveBeenCalledWith('POST', '/api/conversations/chat/runtime/restart', {}, expect.any(Object));
  expect(m.api).toHaveBeenCalledWith('PUT', '/api/conversations/chat/config-options/mode', { value: 'yolo' }, expect.any(Object));
  expect(mcpBindingBlocker(c)).toBeUndefined(); expect(loadAssistants().items[0].mcpRefreshPending).toBeUndefined();
});
it('MCP-02 AC2 permits removing all external services without removing the bridge', async () => {
  await saveAssistantMcp(a, []); expect(selected).toEqual(['bridge']);
});
it.each(['local', 'core'])('MCP-02 AC3 refuses updating a %s busy runtime', async busy => {
  if (busy === 'local') S.running.chat = true;
  else m.api.mockImplementation(async (_method, path) => path === '/api/mcp/servers' ? servers : { ...row(), runtime: { has_task: true, is_processing: true } });
  await expect(saveAssistantMcp(a, ['mail'])).rejects.toThrow(/执行/);
  expect(m.api.mock.calls.some(([method]) => method === 'PATCH')).toBe(false);
});
it('MCP-02 AC3 rejects unknown and internal service selection', async () => {
  await expect(saveAssistantMcp(a, ['missing'])).rejects.toThrow(/服务/);
  await expect(saveAssistantMcp(a, ['other'])).rejects.toThrow(/服务/);
  expect(m.api.mock.calls.some(([method]) => method === 'PATCH')).toBe(false);
});
it('MCP-02 AC3 account changes after reads prevent writes', async () => {
  m.api.mockImplementation(async (_method, path) => { if (path === '/api/mcp/servers') { beginAuthChange(); return servers; } return row(); });
  await expect(saveAssistantMcp(a, ['mail'])).rejects.toThrow(/账号/);
  expect(m.api.mock.calls.some(([method]) => method === 'PATCH')).toBe(false);
});
it('MCP-02 AC3 ownership mismatch is rejected', async () => {
  m.api.mockImplementation(async (_method, path) => path === '/api/mcp/servers' ? servers : { ...row(), extra: { ...row().extra, lom_personal: 'different' } });
  await expect(readAssistantMcp(a)).rejects.toThrow(/归属/);
});
it('MCP-02 AC3 malformed snapshot is not interpreted as no selected services', async () => {
  m.api.mockImplementation(async (_method, path) => path === '/api/mcp/servers' ? servers : { ...row(), extra: { ...row().extra, mcp_server_ids: undefined } });
  await expect(saveAssistantMcp(a, [])).rejects.toThrow(/快照/);
});
it('MCP-02 AC3 concurrent save and sending are blocked during configuration', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  m.api.mockImplementation(async (method, path, body) => { if (method === 'PATCH') { await gate; selected = body.extra.selected_mcp_server_ids; return row(); } return path === '/api/mcp/servers' ? servers : row(); });
  const pending = saveAssistantMcp(a, ['mail']);
  expect(mcpBindingBlocker(c)).toContain('更新');
  await expect(saveAssistantMcp(a, [])).rejects.toThrow(/更新/);
  release(); await pending; expect(mcpBindingBlocker(c)).toBeUndefined();
});
it.each(['mismatch', 'restart', 'permission', 'patch'])('MCP-02 AC4 %s failure never claims application and persists recovery state', async phase => {
  const original = m.api.getMockImplementation()!;
  m.api.mockImplementation(async (method, path, body, opts) => {
    if (phase === 'patch' && method === 'PATCH') throw new Error('timeout');
    if (phase === 'mismatch' && method === 'PATCH') return row();
    if (phase === 'restart' && method === 'POST') throw new Error('offline');
    return original(method, path, body, opts);
  });
  if (phase === 'permission') m.mode.mockImplementation(() => { throw new Error('permission update failed'); });
  await expect(saveAssistantMcp(a, ['mail'])).rejects.toThrow(/未确认/);
  expect(loadAssistants().items[0].mcpRefreshPending).toBe(true);
  expect(mcpBindingBlocker(c)).toContain('未确认');
  expect(m.api.mock.calls.filter(([method]) => method === 'PATCH')).toHaveLength(1);
});
