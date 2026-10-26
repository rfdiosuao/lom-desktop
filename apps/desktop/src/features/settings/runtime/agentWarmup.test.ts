import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
const m = vi.hoisted(() => ({ api: vi.fn(), endpoint: { url: 'http://core', token: 'test', defaultFolder: '/work', homeDir: '/home' } }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => m.endpoint }));
const { prepareAgentTask, takePreparedTask, agentTaskExtra } = await import('./agentWarmup');
const codex = { id: 'codex', backend: 'codex', name: 'Codex CLI', agent_type: 'acp', agent_source: 'builtin', enabled: true, installed: true, status: 'online' as const };
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); S.agentModelPick = {}; S.agentEffortPick = {}; S.permission = 'auto'; localStorage.clear();
  m.api.mockImplementation(async (method: string, path: string, body?: any) => {
    if (method === 'POST' && path === '/api/conversations') return { id: 'warm', type: 'acp', name: body.name, extra: body.extra, created_at: 1, modified_at: 1 };
    return {};
  });
});
afterEach(async () => { dispose?.(); await vi.runAllTimersAsync(); vi.useRealTimers(); });

it('D07 warms without a prompt and adopts the same runtime without waiting for its model catalog', async () => {
  m.api.mockImplementation(async (_method: string, path: string, body?: any) => {
    if (path === '/api/conversations') return { id: 'warm', extra: body.extra };
    if (path.endsWith('/runtime/ensure')) return new Promise(() => {});
    return {};
  });
  dispose = prepareAgentTask(codex, '/work');
  await Promise.resolve();
  const c = await takePreparedTask(agentTaskExtra(codex, '/work'), 'hello');
  dispose();
  expect(c).toMatchObject({ id: 'warm', name: 'hello', extra: { workspace: '/work', lom_probe: false } });
  expect(m.api).toHaveBeenCalledWith('PATCH', '/api/conversations/warm', { name: 'hello', name_source: 'auto', extra: { lom_probe: false } });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(m.api.mock.calls.filter(x => x[0] === 'DELETE')).toHaveLength(0);
  expect(m.api.mock.calls.filter(x => x[1].endsWith('/messages'))).toHaveLength(0);
  expect(await takePreparedTask(agentTaskExtra(codex, '/work'), 'again')).toBeNull();
});

it('EFFORT-01 a prepared task carries the preselected external tier in its create payload', async () => {
  localStorage.setItem('lom.agent-options:codex', JSON.stringify([
    { id: 'thought_level', category: 'thought_level', current_value: 'balanced', options: [{ value: 'fast' }, { value: 'balanced' }, { value: 'deep' }] },
  ]));
  S.agentEffortPick = { codex: 'deep' };
  dispose = prepareAgentTask(codex, '/work');
  await Promise.resolve();
  const create = m.api.mock.calls.find(c => c[0] === 'POST' && c[1] === '/api/conversations');
  expect(create?.[2].extra.thought_level).toBe('deep');
  expect(agentTaskExtra(codex, '/work')).toMatchObject({ thought_level: 'deep' });
});

it.each(['folder', 'model', 'permission'])('D07 never reuses a preparation after changing %s', async changed => {
  dispose = prepareAgentTask(codex, '/work');
  if (changed === 'model') S.agentModelPick.codex = 'new-model';
  if (changed === 'permission') S.permission = 'readonly';
  expect(await takePreparedTask(agentTaskExtra(codex, changed === 'folder' ? '/other' : '/work'), 'hello')).toBeNull();
  await Promise.resolve();
  expect(m.api).toHaveBeenCalledWith('DELETE', '/api/conversations/warm');
});

it('D07 removes an unused preparation after one minute and after navigation', async () => {
  dispose = prepareAgentTask(codex, '/work');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(m.api).toHaveBeenCalledWith('DELETE', '/api/conversations/warm');
  expect(await takePreparedTask(agentTaskExtra(codex, '/work'), 'hello')).toBeNull();
});

it('D07 claims a pending creation before navigation cleanup can delete it', async () => {
  let resolve!: (v: any) => void;
  m.api.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  dispose = prepareAgentTask(codex, '/work');
  const claimed = takePreparedTask(agentTaskExtra(codex, '/work'), 'hello');
  dispose();
  resolve({ id: 'warm', extra: {} });
  expect((await claimed)?.id).toBe('warm');
  expect(m.api.mock.calls.filter(x => x[0] === 'DELETE')).toHaveLength(0);
});

it('D07 startup failure falls back to a normal send; activation failure cleans up and surfaces the error', async () => {
  m.api.mockRejectedValueOnce(new Error('offline'));
  dispose = prepareAgentTask(codex, '/work');
  expect(await takePreparedTask(agentTaskExtra(codex, '/work'), 'hello')).toBeNull();
  dispose = prepareAgentTask(codex, '/work');
  await Promise.resolve();
  m.api.mockRejectedValueOnce(new Error('rename failed'));
  await expect(takePreparedTask(agentTaskExtra(codex, '/work'), 'hello')).rejects.toThrow('rename failed');
  expect(m.api).toHaveBeenCalledWith('DELETE', '/api/conversations/warm');
});

it('D07 a switched core is never asked to delete or adopt another core preparation', async () => {
  dispose = prepareAgentTask(codex, '/work');
  m.endpoint = { ...m.endpoint, url: 'http://another-core' };
  expect(await takePreparedTask(agentTaskExtra(codex, '/work'), 'hello')).toBeNull();
  await Promise.resolve();
  expect(m.api.mock.calls.filter(x => x[0] === 'PATCH' || x[0] === 'DELETE')).toHaveLength(0);
});

it('D07 switching cores during activation cannot deliver the prompt into the new scope', async () => {
  dispose = prepareAgentTask(codex, '/work');
  await Promise.resolve();
  m.api.mockImplementationOnce(async () => { m.endpoint = { ...m.endpoint }; return {}; });
  await expect(takePreparedTask(agentTaskExtra(codex, '/work'), 'hello')).rejects.toThrow('账号或核心已切换');
  expect(m.api.mock.calls.filter(x => x[1].endsWith('/messages') || x[0] === 'DELETE')).toHaveLength(0);
});
