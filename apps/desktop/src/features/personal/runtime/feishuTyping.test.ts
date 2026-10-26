import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { Conv } from '@/state/types';
const m = vi.hoisted(() => ({ invoke: vi.fn(), handlers: {} as Record<string, (e: { payload: unknown }) => void>, send: vi.fn(), stream: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name: string, fn: (e: { payload: unknown }) => void) => { m.handlers[name] = fn; return () => {}; }) }));
vi.mock('@/core/platform', () => ({ inShell: () => true }));
vi.mock('@/features/chat/runtime/tasks', () => ({ sendFromChannel: m.send }));
vi.mock('./feishuCard', () => ({ streamReply: m.stream }));
vi.mock('./session', () => ({ ensureConversation: vi.fn() }));
import { startFeishuRelay } from './feishuRelay';

type Api = { method: string; path: string; body: unknown };
const calls = () => m.invoke.mock.calls.filter(c => c[0] === 'feishu_api').map(c => c[1] as Api);
const arrive = (id: string) => m.handlers['feishu-message']({ payload: { account:'owner', assistant_id:'pa_a', app_id:'cli_a', generation:1, message_id: id, chat_id: 'oc_1', text: '在吗' } });
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)); };
let conv: Conv;

beforeAll(async () => {
  S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' };
  m.invoke.mockImplementation(async (cmd: string) => cmd === 'feishu_status' ? { configured: true, app_id: 'cli_a', authorized: true, generation:1 } : cmd === 'feishu_listen_start' ? 1 : {});
  localStorage.setItem('lom.personal.v1:owner', JSON.stringify({items:[{id:'pa_a',name:'A',directory:'/a',workspace:'/a'}]}));
  startFeishuRelay();
  await vi.waitFor(() => expect(m.invoke).toHaveBeenCalledWith('feishu_listen_start', { account: 'owner', assistantId:'pa_a' }));
});

beforeEach(() => {
  S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' };
  m.invoke.mockReset(); m.send.mockReset(); m.stream.mockReset();
  m.invoke.mockImplementation(async (_cmd: string, a: Api) => a?.method === 'POST' && a.path.endsWith('/reactions') ? { data: { reaction_id: `r_${a.path.split('/')[5]}` } } : {});
  conv = { id: 'c1', owner: 'pc', title: '小麓', updated: 1, messages: [], personal: { id: 'pa_a', name: '小麓', directory: '/a' } } as unknown as Conv;
  S.convs = [conv]; S.running = {};
  localStorage.setItem('lom.personal.v1:owner', JSON.stringify({ items: [{ id: 'pa_a', name: '小麓', directory: '/a', workspace: '/a', conversation: 'c1' }] }));
  m.send.mockResolvedValue({ id: 'u1', type: 'user', at: 1 });
  m.stream.mockResolvedValue(undefined);
});

it('FEISHU-05 a Typing reaction appears as soon as a message arrives, even while the assistant is busy, and goes away after the reply', async () => {
  update(s => { s.running.c1 = true; });
  arrive('om_1');
  await settle();
  // 助理还在忙：消息排队，但表情已经加上
  expect(m.send).not.toHaveBeenCalled();
  expect(calls()).toEqual([{ account: 'owner', assistantId:'pa_a', appId:'cli_a', generation:1, method: 'POST', path: '/open-apis/im/v1/messages/om_1/reactions', body: { reaction_type: { emoji_type: 'Typing' } } }]);
  update(s => { delete s.running.c1; });
  await vi.waitFor(() => expect(calls().some(c => c.method === 'DELETE')).toBe(true));
  expect(m.stream).toHaveBeenCalled();
  expect(calls().at(-1)).toMatchObject({ method: 'DELETE', path: '/open-apis/im/v1/messages/om_1/reactions/r_om_1', body: null });
});

it('FEISHU-05 the reaction is removed even when handling fails, and a failed reaction never blocks the reply', async () => {
  m.stream.mockRejectedValueOnce(new Error('boom'));
  arrive('om_2');
  await vi.waitFor(() => expect(calls().some(c => c.method === 'DELETE')).toBe(true));
  m.invoke.mockImplementation(async (_cmd: string, a: Api) => { if (a?.path?.endsWith('/reactions')) throw new Error('feishu.api_failed: no permission'); return {}; });
  arrive('om_3');
  await vi.waitFor(() => expect(m.stream).toHaveBeenCalledTimes(2));
  await settle();
  expect(calls().filter(c => c.path.includes('om_3') && c.method === 'DELETE')).toEqual([]);
});
