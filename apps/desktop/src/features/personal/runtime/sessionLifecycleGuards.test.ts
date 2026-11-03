import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { Conv } from '@/state/types';
const m = vi.hoisted(() => ({ api: vi.fn(), refresh: vi.fn(), completed: vi.fn(), stopping: vi.fn(() => false) }));
vi.mock('@/core/client', () => ({ api: m.api }));
vi.mock('@/features/phones/runtime/phoneChat', () => ({ refreshPhoneChat: m.refresh }));
vi.mock('@/features/chat/runtime/cancel', () => ({ completedTurnStatus: m.completed, isTaskStopping: m.stopping }));
import { sessionState, waitSession } from './sessionLifecycle';
let target: Conv;
beforeEach(() => {
  vi.clearAllMocks();
  target = { id: 'target', owner: 'pc', title: 'Task', remote: true, messages: [], turnId: 'old' } as unknown as Conv;
  S.convs = [target]; S.running = {}; S.agents = {};
  m.api.mockImplementation(async (_method, path) => path.endsWith('/confirmations') ? [] : { runtime: { is_processing: false, turn_id: 'turn' } });
  m.refresh.mockResolvedValue(false);
});
afterEach(() => vi.useRealTimers());
it('PA-SESSION-02 refuses stale parent or removed target before issuing any query', async () => {
  await expect(sessionState(target, () => false)).rejects.toThrow('变化');
  S.convs = [];
  await expect(sessionState(target, () => true)).rejects.toThrow('变化');
  expect(m.api).not.toHaveBeenCalled();
});
it('PA-SESSION-02 removing the target interrupts an outstanding query without disclosing its approval', async () => {
  m.api.mockReturnValue(new Promise(() => {}));
  const pending = sessionState(target, () => true);
  const rejected = expect(pending).rejects.toThrow('目标会话');
  update(s => { s.convs = []; });
  await rejected;
});
it('PA-SESSION-02 malformed runtime cannot promote a cached finished turn to completed', async () => {
  m.completed.mockReturnValue('finished');
  m.api.mockImplementation(async (_method, path) => path.endsWith('/confirmations') ? [] : {});
  await expect(sessionState(target, () => true)).rejects.toThrow('无法确认');
});
it('PA-SESSION-02 empty questions stay approval and the runtime turn outranks a stale local turn', async () => {
  m.api.mockImplementation(async (_method, path) => path.endsWith('/confirmations') ? [{ id: 'p', description: 'command', questions: [] }] : { runtime: { is_processing: true, turn_id: 'new' } });
  expect(await sessionState(target, () => true)).toMatchObject({ status: 'awaiting_approval', turn_id: 'new' });
  expect(m.completed).toHaveBeenCalledWith('target', 'new');
});
it('PA-SESSION-02 zero timeout allows a real snapshot rather than expiring after one millisecond', async () => {
  vi.useFakeTimers();
  m.api.mockImplementation((_method, path) => new Promise(resolve => setTimeout(() => resolve(path.endsWith('/confirmations') ? [] : { runtime: { is_processing: true, turn_id: 'new' } }), 20)));
  const pending = waitSession(target, { timeout_ms: 0 }, () => true);
  await vi.advanceTimersByTimeAsync(20);
  expect(await pending).toMatchObject({ status: 'running', timed_out: true, turn_id: 'new' });
});

it('PA-SESSION-02 an unconfirmed phone send cannot reuse the previous completed status', async () => {
  target.owner = 'dev_live'; target.phoneRunStatus = 'completed'; target.phonePending = { client_id: 'new-send', session_id: 'phone-session', text: 'new task' };
  expect(await sessionState(target, () => true)).toMatchObject({ status: 'unknown' });
});
