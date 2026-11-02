import { beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { Conv, Msg } from '@/state/types';
const m = vi.hoisted(() => ({ invoke: vi.fn(), send: vi.fn(), ensure: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@/core/platform', () => ({ inShell: () => true }));
vi.mock('@/features/chat/runtime/tasks', () => ({ sendFromChannel: m.send }));
vi.mock('./session', () => ({ ensureConversation: m.ensure }));
import { handleFeishuMessage, restartFeishuRelay } from './feishuRelay';
import { replyOf } from './feishuTurn';

let conv: Conv;
const msg = { account: 'owner', assistant_id: 'pa_a', app_id: 'cli_a', generation: 1, message_id: 'om_1', chat_id: 'oc_1', text: '明天几点开会？' };
// 卡片接口在这里没有返回 card_id，回复退回为纯文本
const replies = () => m.invoke.mock.calls.filter(c => c[0] === 'feishu_api' && c[1].body.msg_type === 'text').map(c => JSON.parse(c[1].body.content).text);

beforeEach(async () => {
  vi.clearAllMocks(); localStorage.clear();
  S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' }; S.running = {};
  conv = { id: 'c1', owner: 'pc', title: '小麓', updated: 1, messages: [], personal: { id: 'pa_a', name: '小麓', directory: '/a' } } as unknown as Conv;
  S.convs = [conv];
  localStorage.setItem('lom.personal.v1:owner', JSON.stringify({ items: [{ id: 'pa_a', name: '小麓', directory: '/a', workspace: '/a', conversation: 'c1' }] }));
  m.invoke.mockImplementation(async (cmd: string) => cmd === 'feishu_status' ? { configured: true, app_id: 'cli_a', authorized: true, generation: 1 } : cmd === 'feishu_listen_start' ? 1 : {});
  // 送进会话后，助理分两段回复，然后这一轮结束
  m.send.mockImplementation(async (c: Conv, text: string, source: string) => {
    const sent: Msg = { id: 'u1', type: 'user', at: 1, text, source: source as Msg['source'] };
    update(s => { c.messages.push(sent); s.running[c.id] = true; });
    setTimeout(() => update(() => { c.messages.push({ id: 'a1', type: 'assistant', at: 2, text: '明天 10 点' }); }), 0);
    setTimeout(() => update(s => { c.messages.push({ id: 'a2', type: 'assistant', at: 3, text: '在 3 号会议室' }); delete s.running[c.id]; }), 5);
    return sent;
  });
  await restartFeishuRelay('owner', 'pa_a');
});

it('FEISHU-02 a Feishu private message goes into the assistant conversation and the reply is sent back to that message', async () => {
  expect(m.invoke).toHaveBeenCalledWith('feishu_listen_start', { account: 'owner', assistantId: 'pa_a' });
  await handleFeishuMessage(msg);
  expect(m.send).toHaveBeenCalledWith(conv, '明天几点开会？', 'feishu', expect.any(Function));
  expect(m.invoke).toHaveBeenCalledWith('feishu_api', expect.objectContaining({ account: 'owner', method: 'POST', path: '/open-apis/im/v1/messages/om_1/reply' }));
  expect(replies()).toEqual(['明天 10 点\n\n在 3 号会议室']);
});

it('FEISHU-02 waits for the assistant to finish its current turn before sending the next message', async () => {
  S.running.c1 = true;
  const pending = handleFeishuMessage(msg);
  await new Promise(r => setTimeout(r, 10));
  expect(m.send).not.toHaveBeenCalled();
  update(s => { delete s.running.c1; });
  await pending;
  expect(m.send).toHaveBeenCalledTimes(1);
});

it('FEISHU-02 tells the Feishu user what to do when there is no assistant or the send fails', async () => {
  m.send.mockResolvedValueOnce(null);
  await handleFeishuMessage(msg);
  expect(replies()).toEqual(['这条消息没有送到助理，请打开 Lom 查看。']);
  localStorage.setItem('lom.personal.v1:owner', JSON.stringify({ items: [] }));
  await handleFeishuMessage(msg);
  expect(replies()).toHaveLength(1);
});

it('FEISHU-02 messages are dropped after the account changes or Feishu is not authorized', async () => {
  S.account = { id: 'other', name: '', email: '' };
  await handleFeishuMessage(msg);
  expect(m.send).not.toHaveBeenCalled();
  S.account = { id: 'owner', name: '', email: '' };
  m.invoke.mockImplementation(async (cmd: string) => cmd === 'feishu_status' ? { configured: true, app_id: 'cli_a', authorized: false } : {});
  await restartFeishuRelay('owner', 'pa_a');
  expect(m.invoke).toHaveBeenCalledWith('feishu_listen_stop', { account: 'owner', assistantId: 'pa_a' });
  await handleFeishuMessage(msg);
  expect(m.send).not.toHaveBeenCalled();
});

it('FEISHU-02 the reply covers only this turn and reports an error when the assistant produced no text', () => {
  const u: Msg = { id: 'u', type: 'user', at: 1, text: 'q' };
  conv.messages = [{ id: 'old', type: 'assistant', at: 0, text: '旧回复' }, u, { id: 't', type: 'tool', at: 2 }, { id: 'e', type: 'system', at: 3, text: '积分不足', ic: 'info' },
    { id: 'next', type: 'user', at: 4, text: '下一条' }, { id: 'later', type: 'assistant', at: 5, text: '后来的回复' }];
  expect(replyOf(conv, u)).toEqual({ text: '积分不足', failed: true, tools: 1 });
});
it('FEISHU-ISOLATE changing the selected assistant never redirects the connected bot', async () => {
  const other = { ...conv, id: 'c2', personal: { id: 'pa_b', name: 'B', directory: '/b' }, messages: [] } as Conv;
  S.convs.push(other);
  const catalog = JSON.parse(localStorage.getItem('lom.personal.v1:owner')!);
  catalog.items.push({ id: 'pa_b', name: 'B', directory: '/b', workspace: '/b', conversation: 'c2' });
  catalog.selected = 'pa_b'; localStorage.setItem('lom.personal.v1:owner', JSON.stringify(catalog));
  await handleFeishuMessage(msg);
  expect(m.send.mock.calls[0][0]).toBe(conv);
  expect(other.messages).toEqual([]);
});
it('FEISHU-ISOLATE a corrupt binding never stops the relay and the unique assistant is migrated', async () => {
  localStorage.setItem('lom.personal.feishu-binding.v1:owner', '{not json');
  await restartFeishuRelay('owner', 'pa_a');
  expect(m.invoke).toHaveBeenCalledWith('feishu_listen_start', { account: 'owner', assistantId: 'pa_a' });
  await handleFeishuMessage(msg);
  expect(m.send.mock.calls[0][0]).toBe(conv);
});
it('FEISHU-MULTI native scope routes independently of selected tab and local binding', async () => {
  localStorage.removeItem('lom.personal.feishu-binding.v1:owner');
  await handleFeishuMessage({ ...msg, assistant_id: 'pa_b', app_id: 'cli_b' });
  expect(m.send).not.toHaveBeenCalled();
  await handleFeishuMessage(msg);
  expect(m.send.mock.calls[0][0]).toBe(conv);
});
it('FEISHU-ISOLATE removing the bound assistant while a message waits never falls back to another assistant', async () => {
  S.running.c1 = true;
  const pending = handleFeishuMessage(msg);
  await new Promise(r => setTimeout(r, 0));
  localStorage.setItem('lom.personal.v1:owner', JSON.stringify({ items: [{ id: 'pa_b', name: 'B', directory: '/b', workspace: '/b' }], selected: 'pa_b' }));
  update(s => { delete s.running.c1; });
  await pending;
  expect(m.send).not.toHaveBeenCalled();
});
