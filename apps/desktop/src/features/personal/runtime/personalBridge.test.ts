import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';
const m = vi.hoisted(() => ({ api: vi.fn(), invoke: vi.fn() }));
vi.mock('@/core/client', async load => ({ ...await load<typeof import('@/core/client')>(), api: m.api }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
import { ensurePersonalBridge } from '@/features/phones/runtime/phoneCommander';

let c: Conv, patched: Record<string, unknown> | undefined;
beforeEach(() => {
  vi.clearAllMocks(); patched = undefined;
  S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' };
  c = { id: 'pa-conv', owner: 'pc', title: '小麓', updated: 1, messages: [], remote: true, personal: { id: 'pa_a', name: '小麓', directory: '/a' } } as Conv;
  m.invoke.mockImplementation(async (_cmd: string, a: { scope: string }) => ({ scope: a.scope, url: 'http://127.0.0.1:1/mcp', token: 't' }));
  m.api.mockImplementation(async (method: string, path: string, body?: { name?: string; extra?: Record<string, unknown> }) => {
    if (method === 'POST' && path === '/api/mcp/servers') return { id: 'mcp_bridge', enabled: false, name: body?.name };
    if (method === 'GET' && path === '/api/mcp/servers') return [{ id: 'mcp_docs', enabled: true, name: 'docs' }, { id: 'mcp_old', enabled: true, name: 'lom-phone-x' }, { id: 'mcp_off', enabled: false, name: 'off' }];
    if (method === 'PATCH') { const extra = body!.extra!; patched = extra; return { id: c.id, extra: { lom_personal_scope: extra.lom_personal_scope, mcp_server_ids: extra.selected_mcp_server_ids } }; }
    if (method === 'GET' && path === `/api/conversations/${c.id}`) return { runtime: { has_task: true } };
    return {};
  });
});

it('PA04 an assistant created before the tools existed gets them in place, keeping its conversation', async () => {
  await ensurePersonalBridge(c);
  expect(String(patched?.lom_personal_scope)).toMatch(/^pa-/);
  expect(patched?.selected_mcp_server_ids).toEqual(['mcp_docs', 'mcp_bridge']);
  expect(c.personalScope).toBe(patched?.lom_personal_scope);
  expect(m.api).toHaveBeenCalledWith('POST', `/api/conversations/${c.id}/runtime/restart`, {});
  // 同一次运行里再发消息不会重复登记
  m.api.mockClear();
  await ensurePersonalBridge(c);
  expect(m.api).not.toHaveBeenCalled();
});

it('PA04 with an older core that cannot re-select tools, the assistant keeps working without them and is not retried every send', async () => {
  m.api.mockImplementation(async (method: string, path: string, body?: { extra?: Record<string, unknown> }) => {
    if (method === 'POST' && path === '/api/mcp/servers') return { id: 'mcp_bridge', enabled: false };
    if (method === 'GET' && path === '/api/mcp/servers') return [];
    if (method === 'PATCH') return { id: c.id, extra: { ...body!.extra, mcp_server_ids: [] } };
    return { runtime: { has_task: true } };
  });
  await ensurePersonalBridge(c);
  expect(c.personalScope).toBeUndefined();
  expect(m.api).not.toHaveBeenCalledWith('POST', `/api/conversations/${c.id}/runtime/restart`, {});
  m.api.mockClear();
  await ensurePersonalBridge(c);
  expect(m.api).not.toHaveBeenCalled();
});
