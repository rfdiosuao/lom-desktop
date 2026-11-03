import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv, Msg } from '@/state/types';

const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', async load => ({ ...await load<object>(), api: m.api }));
const { compactTask, settleCompaction } = await import('./compaction');
const { resetOperations } = await import('./turnLedger');

let c: Conv;
const user: Msg = { id: 'u1', type: 'user', at: 1, text: '原来的问题' };
const notice = () => c.messages.find(x => x.type === 'system')!;
beforeEach(() => {
  vi.clearAllMocks(); resetOperations();
  c = { id: 'c1', owner: 'pc', title: '任务', updated: 0, remote: true, messages: [{ ...user }] };
  S.convs = [c]; S.running = {};
});

it('REFACTOR-01-M3 AC-1 压缩进行中记在提示的状态上，并绑定压缩自己的轮次', async () => {
  m.api.mockResolvedValue({ turn_id: 'compact-turn' });
  await compactTask(c);
  expect(m.api).toHaveBeenCalledWith('POST', '/api/conversations/c1/messages', { content: '/compact', files: [] });
  expect(notice()).toMatchObject({ compaction: 'running', compactTurn: 'compact-turn', text: '正在压缩上下文…' });
  expect(S.running.c1).toBe(true);
  await expect(compactTask(c)).rejects.toThrow(); // 进行中不能再发第二次
  expect(m.api).toHaveBeenCalledTimes(1);
});

it('REFACTOR-01-M3 AC-2 核心拒绝压缩时提示变为「没有开始」，不留下一直转圈的提示', async () => {
  m.api.mockRejectedValue(Object.assign(new Error('bad request'), { status: 400 }));
  await expect(compactTask(c)).rejects.toThrow('bad request');
  expect(notice()).toMatchObject({ compaction: 'failed', text: '压缩没有开始：bad request' });
  expect(S.running.c1).toBeUndefined();
  expect(c.messages[0]).toEqual(user);
});

it('REFACTOR-01-M3 AC-3 请求已发出但回执丢失为「未确认」，不自动重试；之后这一轮的终态仍会结算', async () => {
  m.api.mockRejectedValue(new Error('socket hang up'));
  await expect(compactTask(c)).rejects.toThrow('socket hang up');
  expect(notice()).toMatchObject({ compaction: 'unconfirmed' });
  expect(m.api).toHaveBeenCalledTimes(1);
  c.messages.push({ id: 'r', type: 'assistant', at: 2, text: 'Context compacted: 10k → 2k (4 messages summarized)' });
  settleCompaction(c, 'finished', 'late-compact');
  expect(notice()).toMatchObject({ compaction: 'done', text: expect.stringContaining('4 条消息') });
  expect(c.messages.some(x => x.type === 'assistant')).toBe(false); // 英文压缩回复折叠进提示
});

it('REFACTOR-01-M3 AC-4 压缩中停止：提示说明原有上下文保持不变，历史不动', async () => {
  m.api.mockResolvedValue({ turn_id: 'compact-turn' });
  await compactTask(c);
  settleCompaction(c, 'cancelled', 'compact-turn');
  expect(notice()).toMatchObject({ compaction: 'stopped', text: '压缩已停止，原有上下文保持不变' });
  expect(c.messages[0]).toEqual(user);
});

it('REFACTOR-01-M3 AC-5 别的轮次结束不能把压缩改写成「没有完成」', async () => {
  m.api.mockResolvedValue({ turn_id: 'compact-turn' });
  await compactTask(c);
  settleCompaction(c, 'finished', 'other-turn');
  expect(notice().compaction).toBe('running');
  settleCompaction(c, 'failed', 'compact-turn');
  expect(notice()).toMatchObject({ compaction: 'failed', text: '压缩没有完成，可以稍后重试' });
});

it('REFACTOR-01-M3 AC-6 旧版本只有文字标记的压缩提示仍能结算', () => {
  c.messages.push({ id: 'old', type: 'system', at: 2, text: '正在压缩上下文…', ic: 'refresh' });
  c.messages.push({ id: 'r', type: 'assistant', at: 3, text: 'Context is already compact' });
  settleCompaction(c, 'finished', 'any');
  expect(notice()).toMatchObject({ compaction: 'done', text: '上下文已经很精简，不需要压缩' });
});
