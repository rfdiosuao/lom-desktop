import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv, Msg } from '@/state/types';
const m = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/features/chat/runtime/taskSync', () => ({ refreshTaskList: vi.fn(async () => {}) }));
vi.mock('@/features/workspace/runtime/workspace', () => ({ refreshWorkspace: vi.fn(async () => {}) }));
vi.mock('@/features/personal/runtime/evolution', () => ({ evolvePersonalTurn: vi.fn(async () => {}) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
import { finalCard } from '@/features/personal/runtime/feishuCard';
import { handleCoreEvent } from '@/features/chat/runtime/stream';
import { replyOf } from '@/features/personal/runtime/feishuTurn';
let c: Conv, sent: Msg;
beforeEach(() => {
  vi.clearAllMocks(); sent = { id: 'u', type: 'user', at: 1, text: '执行任务' };
  c = { id: 'review', owner: 'pc', remote: true, title: 'Review', updated: 1, messages: [sent] };
  S.convs = [c]; S.running = {};
});
it('INDEPENDENT-02 partial answer followed by a terminal error must not be labeled completed', () => {
  c.messages.push({ id: 'a', type: 'assistant', at: 2, text: '我来帮你执行' },
    { id: 'error', type: 'system', at: 3, ic: 'info', text: '这一轮没有正常完成（failed）' });
  const reply = replyOf(c, sent);
  expect(reply.failed).toBe(true);
  expect(finalCard(reply, 1000).body.elements[1].content).not.toContain('已完成');
});

it.each(['failed', 'cancelled', 'finished'])('FEISHU-RESULT-01 uses observed terminal state after a partial answer: %s', status => {
  c.messages.push({ id: 'a', type: 'assistant', at: 2, text: '处理中' });
  handleCoreEvent({ name: 'turn.completed', data: { conversation_id: c.id, status } });
  const reply = replyOf(c, sent);
  expect(reply.failed).toBe(status !== 'finished');
  if (status !== 'finished') expect(reply.text).toMatch(/没有正常完成|未完成/);
});
it('FEISHU-RESULT-01 ordinary info is not an execution failure and a later turn cannot contaminate this turn', () => {
  c.messages.push({ id: 'a', type: 'assistant', at: 2, text: '结果' },
    { id: 'info', type: 'system', at: 3, ic: 'info', text: '已切换模型' },
    { id: 'u2', type: 'user', at: 4, text: '下一题' },
    { id: 'e2', type: 'system', at: 5, ic: 'info', text: '下一轮错误', turnOutcome: 'failed' });
  expect(replyOf(c, sent)).toEqual({ text: '结果', failed: false, tools: 0 });
});
it('FEISHU-RESULT-01 structured stream failure retains partial text and the error', () => {
  c.messages.push({ id: 'a', type: 'assistant', at: 2, text: '处理中' });
  handleCoreEvent({ name: 'message.stream', data: { conversation_id: c.id, msg_id: 'e', type: 'error', data: { message: '模型服务不可用' } } });
  const reply = replyOf(c, sent);
  expect(reply.failed).toBe(true); expect(reply.text).toContain('处理中'); expect(reply.text).toContain('模型服务不可用');
});
it('FEISHU-RESULT-01 restored typed errors cannot be hidden by an earlier partial answer', async () => {
  const { mapHistory } = await import('@/features/chat/runtime/history');
  const item = (id: string, type: string, position: 'left' | 'right', content: Record<string, unknown>) => ({ id, msg_id: id, conversation_id: c.id, type, position, content, created_at: 1 });
  c.messages = mapHistory([
    item('u', 'text', 'right', { content: '执行' }),
    item('a', 'text', 'left', { content: '处理中' }),
    item('e', 'error', 'left', { content: '服务不可用' }),
  ], c).messages;
  const reply = replyOf(c, c.messages[0]);
  expect(reply.failed).toBe(true); expect(reply.text).toContain('服务不可用');
});

it('FEISHU-RESULT-01 history replacement retains the matching user outcome by identity', () => {
  c.messages = [{ ...sent, turnOutcome: 'failed' }, { id: 'a', type: 'assistant', at: 2, text: '部分回复' }];
  expect(replyOf(c, sent).failed).toBe(true);
});
it('FEISHU-RESULT-01 a lost turn anchor cannot claim completion', () => {
  c.messages = [];
  const reply = replyOf(c, sent);
  expect(reply.failed).toBe(true); expect(reply.text).toContain('无法核对');
});
