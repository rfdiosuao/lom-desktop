import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';
const m = vi.hoisted(() => ({ api: vi.fn(), rpc: vi.fn(), sendPhone: vi.fn(), refreshPhone: vi.fn(), invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => null }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: m.listen }));
vi.mock('./phoneRpc', () => ({ phoneRpc: m.rpc }));
vi.mock('./phoneChat', () => ({ sendPhone: m.sendPhone, refreshPhoneChat: m.refreshPhone }));
vi.mock('./collaborationSettings', () => ({ monitorDelegated: vi.fn(), stopMonitoring: vi.fn() }));
vi.mock('./phoneCache', () => ({ savePhoneCache: vi.fn() }));
import { executeAgentTool } from './commanderAgents';
import { commanderExtra, executePhoneTool } from './phoneCommander';
import { isTaskStopping, stopTask } from '@/features/chat/runtime/cancel';
import { invalidateDelegations } from '@/features/teams/runtime/delegationLifecycle';

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
let parent: Conv;
let serial = 0;
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); serial++;
  parent = { id: `parent-admission-${serial}`, owner: 'pc', title: 'Parent', updated: 1, remote: true, messages: [] };
  S.convs = [parent]; S.running = { [parent.id]: true }; S.teams = []; S.agentPins = ['codex']; S.agentPick = '';
  S.cloud = 'signed-in'; S.account = { id: 'admission-account', name: 'Test', email: '' };
  S.agentCatalog = [{ id: 'codex', name: 'Codex', backend: 'codex', agent_type: 'acp', agent_source: 'external', installed: true, enabled: true, status: 'online' }];
  m.api.mockResolvedValue({ runtime: { is_processing: false, turn_id: null } });
});
afterEach(() => { vi.useRealTimers(); });

it('D26 stop remains unconfirmed while child creation is pending and a late-created child never receives a message', async () => {
  const created = deferred<object>();
  m.api.mockImplementation(async (method, path) => method === 'POST' && path === '/api/conversations' ? created.promise : { runtime: { is_processing: false, turn_id: null } });
  const admission = executeAgentTool(parent, 'agent_task_start', { agent: 'codex', text: 'do work' });
  const rejected = expect(admission).rejects.toThrow('任务创建失败');
  await vi.advanceTimersByTimeAsync(0);
  const stopped = stopTask(parent.id); await vi.advanceTimersByTimeAsync(15000);
  expect(await stopped).toBe(false); expect(isTaskStopping(parent.id)).toBe(true);
  created.resolve({ id: 'late-child', type: 'acp', extra: { agent_id: 'codex', backend: 'codex', lom_parent: parent.id }, created_at: 1 });
  await rejected; await vi.advanceTimersByTimeAsync(0);
  expect(m.api).toHaveBeenCalledWith('DELETE', '/api/conversations/late-child');
  expect(m.api.mock.calls.some(call => String(call[1]).endsWith('/messages'))).toBe(false);
  expect(isTaskStopping(parent.id)).toBe(false);
});

it('D26 failed cleanup of a late-created idle child remains an explicit stop failure', async () => {
  const created = deferred<object>();
  m.api.mockImplementation(async (method, path) => {
    if (method === 'POST' && path === '/api/conversations') return created.promise;
    if (method === 'DELETE') throw new Error('cleanup offline');
    return { runtime: { is_processing: false, turn_id: null } };
  });
  const admission = executeAgentTool(parent, 'agent_task_start', { agent: 'codex', text: 'do work' });
  const rejected = expect(admission).rejects.toThrow('cleanup offline');
  await vi.advanceTimersByTimeAsync(0);
  const stopped = stopTask(parent.id);
  created.resolve({ id: 'cleanup-child', type: 'acp', extra: { agent_id: 'codex', lom_parent: parent.id } });
  await rejected; await vi.advanceTimersByTimeAsync(0);
  expect(await stopped).toBe(false);
  expect(m.api.mock.calls.some(call => String(call[1]).endsWith('/messages'))).toBe(false);
});

it('D26 a phone start awaiting its remote session keeps parent stop unconfirmed and cancels the late session', async () => {
  m.listen.mockResolvedValue(() => {});
  m.invoke.mockResolvedValue({ url: 'http://127.0.0.1:12345', token: 'test-only' });
  m.api.mockImplementation(async (method, path) => method === 'GET' && path === '/api/mcp/servers' ? [] : { id: 'bridge', enabled: false, runtime: { is_processing: false, turn_id: null } });
  const extra = await commanderExtra(); parent.phoneScope = extra.lom_phone_scope;
  S.agents.dev_late_phone = { id: 'dev_late_phone', name: 'Phone', kind: 'phone', persona: '', real: true, status: 'online' };
  S.convPhones[parent.id] = ['dev_late_phone'];
  const sent = deferred<void>(); let child!: Conv;
  m.sendPhone.mockImplementation(async c => { child = c; await sent.promise; c.phoneSession = 'late-session'; S.running[c.id] = true; });
  let cancelled = false;
  m.rpc.mockImplementation(async (_device, method) => { if (method === 'chat.cancel') cancelled = true; return {}; });
  m.refreshPhone.mockImplementation(async c => { if (cancelled) delete S.running[c.id]; });
  const admission = executePhoneTool({ id: 'c'.repeat(64), scope: parent.phoneScope!, name: 'phone_task_start', arguments: JSON.stringify({ device: 'dev_late_phone', text: 'phone work' }) });
  await vi.advanceTimersByTimeAsync(0); expect(child).toBeDefined();
  const stopped = stopTask(parent.id); await vi.advanceTimersByTimeAsync(15000);
  expect(await stopped).toBe(false); expect(isTaskStopping(parent.id)).toBe(true);
  sent.resolve(); const result = await admission; await vi.advanceTimersByTimeAsync(0);
  expect(result).toMatchObject({ isError: true });
  expect(m.rpc).toHaveBeenCalledWith('dev_late_phone', 'chat.cancel', { session_id: 'late-session' });
  expect(S.running[child.id]).toBeUndefined(); expect(isTaskStopping(parent.id)).toBe(false);
});

it('D26 a parent invalidated during an existing phone-session refresh never sends a new phone task', async () => {
  m.listen.mockResolvedValue(() => {}); m.invoke.mockResolvedValue({ url: 'http://127.0.0.1:12345', token: 'test-only' });
  m.api.mockImplementation(async (method, path) => method === 'GET' && path === '/api/mcp/servers' ? [] : { id: 'bridge', enabled: false });
  const extra = await commanderExtra(); parent.phoneScope = extra.lom_phone_scope;
  S.agents.dev_late_phone = { id: 'dev_late_phone', name: 'Phone', kind: 'phone', persona: '', real: true, status: 'online' };
  S.convPhones[parent.id] = ['dev_late_phone'];
  S.convs.push({ id: 'existing-phone', owner: 'dev_late_phone', phoneSession: 'existing-session', title: 'Phone', updated: 1, messages: [] });
  const refreshed = deferred<void>(); m.refreshPhone.mockReturnValue(refreshed.promise);
  const admission = executePhoneTool({ id: 'd'.repeat(64), scope: parent.phoneScope!, name: 'phone_task_start', arguments: JSON.stringify({ device: 'dev_late_phone', session_id: 'existing-session', text: 'phone work' }) });
  await vi.advanceTimersByTimeAsync(0); invalidateDelegations(parent.id); refreshed.resolve();
  expect(await admission).toMatchObject({ isError: true }); expect(m.sendPhone).not.toHaveBeenCalled();
});

it.each(['offline', 'online'] as const)('D26 an unresolved phone send remains unconfirmed when the device is %s', async status => {
  S.agents.dev_pending_phone = { id: 'dev_pending_phone', name: 'Phone', kind: 'phone', persona: '', real: true, status };
  S.convs.push({ id: 'pending-phone', owner: 'dev_pending_phone', parentTask: parent.id, phoneSession: 'old-session', title: 'Phone', updated: 1, messages: [],
    phonePending: { client_id: 'uncertain-request', text: 'work', session_id: 'old-session', policy: '', files: '[]' } });
  m.refreshPhone.mockResolvedValue(undefined);
  expect(await stopTask(parent.id)).toBe(false);
  expect(m.rpc).not.toHaveBeenCalled();
});
