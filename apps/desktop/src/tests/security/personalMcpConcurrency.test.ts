import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';
import { storeAssistant, loadAssistants, type PersonalAssistant } from '@/features/personal/runtime/catalog';
const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', async load => ({ ...await load<typeof import('@/core/client')>(), api: m.api }));
import { saveAssistantMcp } from '@/features/personal/runtime/mcpBindings';
import { applyPersonalPermission, requestPermissionTier } from '@/features/personal/runtime/permissions';
let a: PersonalAssistant;
function row() { return { id: 'chat', type: 'aionrs', extra: { lom_personal: 'pa_a', lom_personal_directory: '/a', lom_personal_scope: 'pa-local', mcp_server_ids: ['bridge'] }, runtime: { has_task: true, is_processing: false } }; }
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); S.account = { id: 'owner', name: '', email: '' }; S.cloud = 'signed-in'; S.running = {};
  a = { id: 'pa_a', name: 'A', directory: '/a', workspace: '/a', conversation: 'chat', permission: 'full', permissionMigrated: true };
  S.convs = [{ id: 'chat', title: 'A', owner: 'pc', updated: 1, messages: [], personal: { id: a.id, name: a.name, directory: a.directory } } as Conv];
  storeAssistant(a);
});
it('MCP-02 permission cannot race an MCP refresh and restore stale full access', async () => {
  let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  m.api.mockImplementation(async (method, path) => {
    if (path === '/api/mcp/servers') return [{ id: 'bridge', name: 'lom-phone-pa-local', enabled: false, builtin: false }];
    if (method === 'PATCH') await gate;
    return row();
  });
  const pending = saveAssistantMcp(a, []);
  try {
    await expect(requestPermissionTier(a, 'ask')).rejects.toThrow(/配置.*更新/);
    expect(loadAssistants().items[0].permissionPending).toBeUndefined();
  } finally { release(); await pending; }
});
it('MCP-02 an in-flight permission update blocks MCP writes until its mode is confirmed', async () => {
  let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  m.api.mockImplementation(async () => { await gate; return {}; });
  const pending = applyPersonalPermission(a);
  try { await expect(saveAssistantMcp(a, [])).rejects.toThrow(/配置.*更新/); }
  finally { release(); await pending; }
  expect(m.api.mock.calls.some(([method]) => method === 'PATCH')).toBe(false);
});

it('MCP-02 unconfirmed MCP updates and in-flight configuration block the real send path', async () => {
  const { sendToTask } = await import('@/features/chat/runtime/tasks');
  const { lockPersonalConfiguration } = await import('@/features/personal/runtime/configurationLock');
  const release = lockPersonalConfiguration('chat');
  try { expect(await sendToTask(S.convs[0], 'do work', [])).toBe(false); }
  finally { release(); }
  storeAssistant({ ...a, mcpRefreshPending: true });
  expect(await sendToTask(S.convs[0], 'do work', [])).toBe(false);
  expect(S.convs[0].messages).toEqual([]); expect(m.api).not.toHaveBeenCalled();
});
