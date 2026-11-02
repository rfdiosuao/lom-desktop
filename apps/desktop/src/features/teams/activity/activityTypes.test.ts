import { describe, expect, it } from 'vitest';
import {
  buildActivityItems, FALLBACK_LANE, filterActivityItems, isFinishedTaskStatus, isSystemMessageType,
  laneColor, resolveMessageLane, resolveTaskLane, sortActivityItems,
} from './activityTypes';
import type { TeamMailboxMessage, TeamTask } from './activityTypes';

/* D33-AC-3 / D33-AC-4：泳道归属、排序、筛选（行为测试，不读源码文本）。 */

const SLOTS = new Set(['lead', 'w1']);

const msg = (id: string, from: string, to: string, extra: Partial<TeamMailboxMessage> = {}): TeamMailboxMessage => ({
  id, team_id: 't1', from_agent_id: from, to_agent_id: to, msg_type: 'message', content: `内容 ${id}`,
  summary: null, files: [], read: false, created_at: 1000, ...extra,
});

const task = (id: string, owner: string | null, extra: Partial<TeamTask> = {}): TeamTask => ({
  id, team_id: 't1', subject: `任务 ${id}`, description: null, status: 'pending', owner,
  blocked_by: [], blocks: [], created_at: 2000, updated_at: 2000, ...extra,
});

describe('D33-AC-3 泳道归属', () => {
  it('消息进收件人列，广播进发件人列', () => {
    expect(resolveMessageLane(msg('m1', 'lead', 'w1'), SLOTS)).toBe('w1');
    expect(resolveMessageLane(msg('m2', 'w1', '*'), SLOTS)).toBe('w1');
  });

  it('用户、空收件人和已移除成员进未分配列', () => {
    expect(resolveMessageLane(msg('m3', 'lead', 'user'), SLOTS)).toBe(FALLBACK_LANE);
    expect(resolveMessageLane(msg('m4', 'lead', ''), SLOTS)).toBe(FALLBACK_LANE);
    expect(resolveMessageLane(msg('m5', 'lead', 'gone'), SLOTS)).toBe(FALLBACK_LANE);
  });

  it('任务进负责人列，没有负责人时进未分配列', () => {
    expect(resolveTaskLane(task('t1', 'w1'), SLOTS)).toBe('w1');
    expect(resolveTaskLane(task('t2', null), SLOTS)).toBe(FALLBACK_LANE);
    expect(resolveTaskLane(task('t3', 'user'), SLOTS)).toBe(FALLBACK_LANE);
  });

  it('同一 slot 的圆点颜色稳定，未知身份也有颜色', () => {
    expect(laneColor('w1')).toBe(laneColor('w1'));
    expect(laneColor('')).toContain('var(--');
  });
});

describe('D33 排序', () => {
  it('按时间排序，方向可切换，同一时间用 id 稳定排序', () => {
    const items = buildActivityItems([msg('b', 'lead', 'w1', { created_at: 5 }), msg('a', 'lead', 'w1', { created_at: 5 })], [task('c', 'w1', { created_at: 9 })], SLOTS, 'desc');
    expect(items.map((i) => i.id)).toEqual(['c', 'b', 'a']);
    expect(sortActivityItems(items, 'asc').map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('排序不改变原数组', () => {
    const items = buildActivityItems([msg('a', 'lead', 'w1')], [], SLOTS, 'desc');
    const sorted = sortActivityItems(items, 'asc');
    expect(sorted).not.toBe(items);
  });
});

describe('D33-AC-4 筛选', () => {
  const items = buildActivityItems(
    [
      msg('m1', 'lead', 'w1', { created_at: 1 }),
      msg('m2', 'w1', 'lead', { created_at: 2, msg_type: 'idle_notification' }),
      msg('m3', 'lead', '*', { created_at: 3 }),
    ],
    [task('t1', 'w1', { created_at: 4 }), task('t2', 'lead', { created_at: 5, status: 'completed' })],
    SLOTS,
    'desc',
  );
  const base = { kind: 'all' as const, members: new Set<string>(), showSystemMessages: false, showFinishedTasks: false };

  it('默认隐藏系统消息和已完成任务', () => {
    expect(filterActivityItems(items, base).map((i) => i.id)).toEqual(['t1', 'm3', 'm1']);
  });

  it('打开开关后系统消息和已完成任务出现', () => {
    const shown = filterActivityItems(items, { ...base, showSystemMessages: true, showFinishedTasks: true });
    expect(shown.map((i) => i.id)).toEqual(['t2', 't1', 'm3', 'm2', 'm1']);
    expect(isSystemMessageType('idle_notification')).toBe(true);
    expect(isFinishedTaskStatus('completed')).toBe(true);
  });

  it('内容筛选只留消息或任务', () => {
    expect(filterActivityItems(items, { ...base, kind: 'message' }).every((i) => i.kind === 'message')).toBe(true);
    expect(filterActivityItems(items, { ...base, kind: 'task' }).every((i) => i.kind === 'task')).toBe(true);
  });

  it('成员筛选按泳道生效，未分配列也能单独选', () => {
    expect(filterActivityItems(items, { ...base, members: new Set(['w1']) }).map((i) => i.id)).toEqual(['t1', 'm1']);
    expect(filterActivityItems(items, { ...base, members: new Set([FALLBACK_LANE]) })).toEqual([]);
    expect(filterActivityItems(items, { ...base, members: new Set(['lead']) }).map((i) => i.id)).toEqual(['m3']);
  });
});
