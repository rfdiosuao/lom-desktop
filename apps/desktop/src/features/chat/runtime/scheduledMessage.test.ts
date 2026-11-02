import { beforeEach, expect, it, vi } from 'vitest';
import { scheduledMessage, syncScheduledMessages } from './scheduledMessage';
import { mapHistory } from './history';
import { S } from '@/state/store';
import type { CoreMessage } from '@/core/types';
import type { Conv } from '@/state/types';
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', () => ({ api, getEndpoint: () => null }));
const existing = '[Scheduled Task Execution]\nTask: 巡检\nSchedule: 每小时\n\nRules:\nExecute directly.\n\nTask instruction:\n查看当前应用\n记录变化';
const item = (text = existing): CoreMessage => ({ id: 'cron-message', msg_id: 'cron-message', conversation_id: 'c', type: 'text', position: 'right', hidden: true, created_at: 10, content: { content: text } });
let conv: Conv;
beforeEach(() => { api.mockReset(); conv = { id: 'c', owner: 'pc', title: '巡检', updated: 0, remote: true, messages: [] }; S.convs = [conv]; S.account = null; });
it('D04 restores the actual existing-task prompt before its reply without exposing wrapper rules', () => {
  const { messages } = mapHistory([item(), { ...item('完成'), id: 'reply', msg_id: 'reply', hidden: false, position: 'left', created_at: 11 }], conv);
  expect(messages.map(m => m.type)).toEqual(['user', 'assistant']);
  expect(messages[0]).toMatchObject({ source: 'schedule', text: '查看当前应用\n记录变化' });
});
it('D04 new-conversation task strips the skill suggestion suffix and preserves user content', () => {
  const text = '[Scheduled Task Context]\nTask: 巡检\nRules:\n4. create a file (see instructions at the end).\n[/Scheduled Task Context]\n\n查看应用\n\n---\n\n[Post-Task] create a skill';
  expect(scheduledMessage(item(text))?.text).toBe('查看应用');
  expect(scheduledMessage(item('[Scheduled Task Context]\nTask: 新闻\nRules:\nRead skill.\n[/Scheduled Task Context]\n\n今日新闻'))?.text).toBe('今日新闻');
});
it('D04 internal hidden messages and ordinary user text are not reclassified', () => {
  expect(scheduledMessage(item('内部系统消息'))).toBeNull();
  expect(scheduledMessage({ ...item(), hidden: false })).toBeNull();
  expect(scheduledMessage({ ...item(), position: 'left' })).toBeNull();
  expect(mapHistory([item('内部系统消息')], conv).messages).toEqual([]);
});
it('D04 live artifact refresh inserts before an in-flight reply, keeps it intact and deduplicates repeated events', async () => {
  const reply = { id: 'reply', type: 'assistant' as const, at: 10, text: '正在检查', streaming: true };
  conv.messages = [reply]; api.mockResolvedValue({ items: [item()] });
  await syncScheduledMessages(conv); await syncScheduledMessages(conv);
  expect(conv.messages).toHaveLength(2); expect(conv.messages[0].source).toBe('schedule');
  expect(conv.messages[1]).toBe(reply); expect(reply.streaming).toBe(true);
});
it('D04 a delayed refresh cannot modify a removed conversation', async () => {
  let resolve!: (value: unknown) => void;
  api.mockImplementation(() => new Promise(r => { resolve = r; }));
  const pending = syncScheduledMessages(conv); S.convs = [];
  resolve({ items: [item()] }); await pending;
  expect(conv.messages).toEqual([]);
});
it('D04 the real cron artifact event refreshes its conversation and repeated events do not duplicate prompts', async () => {
  const { handleCoreEvent } = await import('./stream');
  api.mockResolvedValue({ items: [item()] });
  handleCoreEvent({ name: 'conversation.artifact', data: { kind: 'cron_trigger', conversation_id: 'c', id: 'artifact1' } });
  await vi.waitFor(() => expect(conv.messages).toHaveLength(1));
  handleCoreEvent({ name: 'conversation.artifact', data: { kind: 'cron_trigger', conversation_id: 'c', id: 'artifact1' } });
  await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  expect(conv.messages).toHaveLength(1);
  expect(conv.messages[0]).toMatchObject({ source: 'schedule', text: '查看当前应用\n记录变化' });
});
