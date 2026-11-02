import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv, DraftAttachment } from '@/state/types';
const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => null }));
import { retryTaskMessage, sendToTask } from './tasks';
import { handleCoreEvent } from './stream';

let task: Conv;
let sequence = 0;
const attachment: DraftAttachment = { name: 'only-copy.md', path: '/uploaded/only-copy.md', kind: 'upload' };
beforeEach(() => {
  m.api.mockReset(); S.running = {}; S.permission = 'ask';
  task = { id: `failed-message-${++sequence}`, owner: 'pc', remote: true, agentId: 'codex', title: 'Task', updated: 1, messages: [] };
  S.convs = [task];
  m.api.mockImplementation(async (_method, path) => { if (path.endsWith('/messages')) throw Object.assign(new Error('rejected'), { status: 400 }); return {}; });
});

it('D26 failed attachment-only sends retain reusable paths and retry the exact message without a duplicate bubble', async () => {
  expect(await sendToTask(task, '', [attachment])).toBe(false);
  const original = task.messages.find(x => x.type === 'user')!;
  expect(original.status).toBe('error');
  expect(original.attachments).toEqual([expect.objectContaining(attachment)]);
  S.drafts[`conv:${task.id}`] = 'fresh draft';
  S.attachments[`conv:${task.id}`] = [{ name: 'new-file', path: '/new-file' }];
  m.api.mockResolvedValue({ turn_id: 'retry-turn' });
  expect(await retryTaskMessage(task, original)).toBe(true);
  expect(m.api).toHaveBeenLastCalledWith('POST', `/api/conversations/${task.id}/messages`, expect.objectContaining({ files: [{ kind: 'upload', path: '/uploaded/only-copy.md' }] }));
  expect(task.messages.filter(x => x.type === 'user')).toEqual([original]);
  expect(original.status).toBe('done');
  expect(S.drafts[`conv:${task.id}`]).toBe('fresh draft');
  expect(S.attachments[`conv:${task.id}`][0].path).toBe('/new-file');
});

it('D26 a second failed retry remains retryable and an active turn blocks duplicate submission', async () => {
  await sendToTask(task, 'original', [attachment]);
  const original = task.messages.find(x => x.type === 'user')!;
  expect(await retryTaskMessage(task, original)).toBe(false);
  expect(original.status).toBe('error');
  S.running[task.id] = true; m.api.mockClear();
  expect(() => retryTaskMessage(task, original)).toThrow('当前任务');
  expect(m.api).not.toHaveBeenCalled();
});

it.each([false, true])('D26 a lost POST response cannot retry an accepted message after terminal=%s', async terminal => {
  let reject!: (error: Error) => void;
  m.api.mockImplementation(async (_method, path) => path.endsWith('/messages') ? new Promise((_resolve, fail) => { reject = fail; }) : {});
  const sending = sendToTask(task, 'accepted question', []);
  await vi.waitFor(() => expect(reject).toBeTypeOf('function'));
  handleCoreEvent({ name: 'message.userCreated', data: { conversation_id: task.id, msg_id: 'accepted-user', content: 'accepted question', created_at: 1 } });
  handleCoreEvent({ name: 'message.stream', data: { conversation_id: task.id, turn_id: 'accepted-turn', msg_id: 'reply', type: 'start', data: {} } });
  if (terminal) handleCoreEvent({ name: 'turn.completed', data: { conversation_id: task.id, turn_id: 'accepted-turn', status: 'cancelled' } });
  reject(new Error('response lost'));
  expect(await sending).toBe(true);
  const original = task.messages.find(message => message.type === 'user')!;
  expect(original).toMatchObject({ status: 'done', remoteId: 'accepted-user' });
  expect(!!S.running[task.id]).toBe(!terminal);
  expect(() => retryTaskMessage(task, original)).toThrow('可重试');
  expect(task.messages.filter(message => message.type === 'user')).toHaveLength(1);
});

it('D26 unknown POST outcomes remain unconfirmed and cannot use failed-message retry', async () => {
  m.api.mockImplementation(async (_method, path) => { if (path.endsWith('/messages')) throw new Error('response lost'); return {}; });
  expect(await sendToTask(task, 'uncertain question', [])).toBe(false);
  const original = task.messages.find(message => message.type === 'user')!;
  expect(original.status).toBe('unconfirmed'); expect(S.running[task.id]).toBe(true);
  expect(() => retryTaskMessage(task, original)).toThrow('可重试');
});

it('D26 contradictory own-message acknowledgement and HTTP rejection remain unconfirmed without retry', async () => {
  let reject!: (error: Error) => void;
  m.api.mockImplementation(async (_method, path) => path.endsWith('/messages') ? new Promise((_resolve, fail) => { reject = fail; }) : {});
  const sending = sendToTask(task, 'own question', []);
  await vi.waitFor(() => expect(reject).toBeTypeOf('function'));
  handleCoreEvent({ name: 'message.userCreated', data: { conversation_id: task.id, msg_id: 'own-user', content: 'own question', created_at: 1 } });
  reject(Object.assign(new Error('conflicting rejection'), { status: 409 }));
  expect(await sending).toBe(false);
  const original = task.messages.find(message => message.type === 'user')!;
  expect(original).toMatchObject({ status: 'unconfirmed', remoteId: 'own-user' });
  expect(() => retryTaskMessage(task, original)).toThrow('可重试');
});

it('D26 another client stream cannot acknowledge this client question after its POST response is lost', async () => {
  let reject!: (error: Error) => void;
  m.api.mockImplementation(async (_method, path) => path.endsWith('/messages') ? new Promise((_resolve, fail) => { reject = fail; }) : {});
  const sending = sendToTask(task, 'own question', []);
  await vi.waitFor(() => expect(reject).toBeTypeOf('function'));
  handleCoreEvent({ name: 'message.userCreated', data: { conversation_id: task.id, msg_id: 'foreign-user', content: 'another client question', created_at: 1 } });
  handleCoreEvent({ name: 'message.stream', data: { conversation_id: task.id, turn_id: 'foreign-turn', msg_id: 'foreign-reply', type: 'start', data: {} } });
  reject(new Error('response lost'));
  expect(await sending).toBe(false);
  const original = task.messages.find(message => message.type === 'user' && message.text === 'own question')!;
  expect(original.status).toBe('unconfirmed'); expect(original.remoteId).toBeUndefined();
  expect(S.running[task.id]).toBe(true);
  expect(() => retryTaskMessage(task, original)).toThrow('可重试');
});
