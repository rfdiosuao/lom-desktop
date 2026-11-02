import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';
const m = vi.hoisted(() => ({ api: vi.fn(), stop: vi.fn() }));
vi.mock('@/core/client', async load => ({ ...await load<typeof import('@/core/client')>(), api: m.api }));
vi.mock('./feishuRelay',()=>({stopFeishuRelay:m.stop}));
import { deleteAssistant } from './deleteAssistant';
import { loadAssistants } from './catalog';
import { bindFeishuAssistant, feishuAssistant } from './feishuBinding';
import { CoreError } from '@/core/client';

const job = (id: string, conversation: string) => ({ id, name: id, enabled: true, schedule: { kind: 'cron', expr: '0 9 * * *' }, target: { payload: { text: 'x' }, execution_mode: 'existing' }, metadata: { conversation_id: conversation, created_by: 'user' }, state: { run_count: 0 } });
const items = [
  { id: 'pa_a', name: '小麓', directory: '/a', workspace: '/a', conversation: 'conv-a' },
  { id: 'pa_b', name: '小二', directory: '/b', workspace: '/b', conversation: 'conv-b' },
];

beforeEach(() => {
  m.stop.mockReset();m.stop.mockResolvedValue(undefined);
  m.api.mockReset(); localStorage.clear();
  S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' }; S.running = {};
  S.convs = [{ id: 'conv-a', personal: { id: 'pa_a' } }, { id: 'conv-b', personal: { id: 'pa_b' } }] as unknown as Conv[];
  localStorage.setItem('lom.personal.v1:owner', JSON.stringify({ items, selected: 'pa_a' }));
  localStorage.setItem('lom.personal.heartbeats.v1:owner:pa_a', '{"daily":"done"}');
  m.api.mockImplementation(async (method: string, path: string) => method === 'GET' && path === '/api/cron/jobs' ? [job('daily-a', 'conv-a'), job('weekly-a', 'conv-a'), job('daily-b', 'conv-b')] : {});
});

it('PA-DELETE deletes its scheduled tasks, archives its conversation, preserves Feishu recovery ownership and removes it from the list', async () => {
  bindFeishuAssistant('owner', 'cli_bot', 'pa_a');
  await deleteAssistant(items[0]);
  expect(m.stop).toHaveBeenCalledWith('owner','pa_a');
  const deletes = m.api.mock.calls.filter(c => c[0] === 'DELETE').map(c => c[1]);
  expect(deletes).toEqual(['/api/cron/jobs/daily-a', '/api/cron/jobs/weekly-a']);
  expect(m.api).toHaveBeenCalledWith('POST', '/api/sidebar/conversation/conv-a/archive');
  expect(loadAssistants('owner')).toMatchObject({ items: [{ id: 'pa_b' }], selected: 'pa_b' });
  expect(S.convs.map(c => c.id)).toEqual(['conv-b']);
  expect(localStorage.getItem('lom.personal.heartbeats.v1:owner:pa_a')).toBeNull();
  // 飞书机器人空出来了，可以绑给别的助理
  expect(feishuAssistant('owner', 'cli_bot')).toBeUndefined();
  expect(() => bindFeishuAssistant('owner', 'cli_bot', 'pa_b')).toThrow('feishu.binding_owned');
});

it('PA-DELETE refuses while the assistant is running and leaves everything as it was', async () => {
  S.running = { 'conv-a': true };
  await expect(deleteAssistant(items[0])).rejects.toThrow('先停止再删除');
  expect(m.api).not.toHaveBeenCalled();
  expect(loadAssistants('owner').items).toHaveLength(2);
});

it('PA-DELETE stops at a failed step instead of hiding an assistant whose tasks still run', async () => {
  m.api.mockImplementation(async (method: string) => {
    if (method === 'GET') return [job('daily-a', 'conv-a')];
    if (method === 'DELETE') throw new CoreError('X', 'boom', 500);
    return {};
  });
  await expect(deleteAssistant(items[0])).rejects.toThrow();
  expect(loadAssistants('owner').items).toHaveLength(2);
  // 会话已经不在核心里时仍可删除
  m.api.mockImplementation(async (method: string) => { if (method === 'GET') return []; if (method === 'POST') throw new CoreError('NOT_FOUND', 'gone', 404); return {}; });
  await deleteAssistant(items[0]);
  expect(loadAssistants('owner').items.map(a => a.id)).toEqual(['pa_b']);
});

it('FEISHU-MULTI failed listener stop keeps assistant available for recovery',async()=>{
 m.stop.mockRejectedValue(new Error('feishu.stop_failed'));
 await expect(deleteAssistant(items[0])).rejects.toThrow('feishu.stop_failed');
 expect(loadAssistants('owner').items).toHaveLength(2);
});
