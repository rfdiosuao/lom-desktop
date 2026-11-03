import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { api } from '@/core/client';
import { sendToTask } from '@/features/chat/runtime/tasks';
import { readDocument } from './memory';
import { evolvePersonalTurn } from './evolution';
/* PA-LATENCY-01：个人助理发送路径——上一轮学习不挡住发送，首次发送只重启一次运行时 */
const m = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => m.invoke(...a), isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@/core/client', async load => ({ ...await load<typeof import('@/core/client')>(), api: vi.fn() }));
vi.mock('@/features/account/runtime/cloud', () => ({ ensureLomSelection: vi.fn(async () => {}) }));
vi.mock('@/features/chat/runtime/taskModel', async load => ({ ...await load<typeof import('@/features/chat/runtime/taskModel')>(), ensureTaskModel: vi.fn(async () => {}) }));
vi.mock('./memory', async load => ({ ...await load<typeof import('./memory')>(), readDocument: vi.fn(async () => '旧偏好') }));
vi.mock('./feishuTurn', () => ({ followTurn: vi.fn(async () => ({ text: 'answer', failed: false, tools: 0 })) }));

let c: any;
const calls = () => vi.mocked(api).mock.calls.map(([method, path]) => `${method} ${path}`);
const posts = () => vi.mocked(api).mock.calls.filter(([method, path]) => method === 'POST' && String(path).endsWith('/messages')).map(x => String((x[2] as { content: string }).content));
beforeEach(() => {
  vi.clearAllMocks(); S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' }; S.running = {}; S.teams = [];
  S.providers = [{ id: 'cloud', name: 'Lom 云端', enabled: true, models: ['pro'] } as any]; S.cloudModels = { pro: 'pro', max: 'max', mini: 'mini' };
  c = { id: crypto.randomUUID(), owner: 'pc', title: '小麓', updated: 1, remote: true, modelId: 'cloud::pro', providerId: 'cloud', personalScope: `pa-${crypto.randomUUID()}`,
    personal: { id: 'pa_a', name: '小麓', directory: '/a' }, messages: [
      { id: 'u', remoteId: 'user-1', type: 'user', at: 1, text: '以后回答简短一点' }, { id: 'r', type: 'assistant', at: 2, text: '好的' }] };
  S.convs = [c];
  localStorage.setItem('lom.personal.v1:owner', JSON.stringify({ items: [{ id: 'pa_a', name: '小麓', directory: '/a', workspace: '/a', conversation: c.id, permission: 'routine', permissionMigrated: true }] }));
  m.invoke.mockImplementation(async (name: string) => (name === 'phone_bridge_config' ? { url: 'http://127.0.0.1:1/mcp', token: 'fixture' } : name === 'personal_reflect' ? '[]' : { adopted: 0, version: 0 }));
  vi.mocked(api).mockImplementation(async (method: string, path: string) => {
    if (method === 'GET' && path === `/api/conversations/${c.id}`) return { runtime: { has_task: true, is_processing: false } } as never;
    if (method === 'GET' && path === '/api/providers') return [{ id: 'cloud', name: 'Lom 云端', enabled: true, api_key: 'fixture', base_url: 'https://fixture.invalid/v1', models: ['pro'] }] as never;
    if (method === 'POST' && path === '/api/mcp/servers') return { id: 'mcp_bridge', enabled: false } as never;
    return { turn_id: 'turn' } as never;
  });
});
afterEach(() => { vi.useRealTimers(); });

it('PA-LATENCY-01 AC-1 上一轮学习一直没结束，最多等 300 毫秒就发送；学习写完后下一次发送带上新记忆', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let release!: () => void;
  m.invoke.mockImplementation(async (name: string) => name === 'personal_reflect' ? new Promise<string>(r => { release = () => r('[]'); })
    : name === 'phone_bridge_config' ? { url: 'http://127.0.0.1:1/mcp', token: 'fixture' } : { adopted: 1, version: 2, correction: false });
  const learning = evolvePersonalTurn(c, 'turn-1');
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const sending = sendToTask(c, '下一条消息', []);
  await vi.advanceTimersByTimeAsync(300);
  expect(await sending).toBe(true);
  expect(posts()).toHaveLength(1);
  expect(posts()[0]).toContain('旧偏好');
  // 学习在发送之后才写完文档：版本变化，下一次发送带上新记忆
  vi.mocked(readDocument).mockResolvedValue('学习后的偏好');
  release(); await learning;
  S.running = {};
  expect(await sendToTask(c, '再下一条', [])).toBe(true);
  expect(posts()[1]).toContain('学习后的偏好');
});

it('PA-LATENCY-01 AC-2 冷启动时有旧运行时的首次发送只重启一次，模式照常设置', async () => {
  expect(await sendToTask(c, '你好', [])).toBe(true);
  const list = calls(), restart = list.filter(x => x.endsWith('/runtime/restart'));
  expect(restart).toEqual([`POST /api/conversations/${c.id}/runtime/restart`]);
  const put = list.indexOf(`PUT /api/conversations/${c.id}/config-options/mode`), post = list.indexOf(`POST /api/conversations/${c.id}/messages`);
  expect(list.indexOf(restart[0])).toBeLessThan(post);
  expect(put).toBeGreaterThan(-1); expect(put).toBeLessThan(post);
  // 权限已记为生效：下一次发送不再重置运行时
  vi.mocked(api).mockClear(); S.running = {};
  expect(await sendToTask(c, '第二条', [])).toBe(true);
  expect(calls().some(x => x.endsWith('/runtime/restart'))).toBe(false);
});
