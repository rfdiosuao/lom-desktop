import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/core/client';
import type { ActivityPage, TeamMailboxMessage, TeamTask } from './activityTypes';
import { emitActivityEvent } from './activityEvents';
import { useTeamActivityFeed } from './useTeamActivityFeed';

/* D33-AC-1 分页合并、D33-AC-2 epoch、D33-AC-8 实时 upsert。 */

vi.mock('@/core/client', () => ({ api: vi.fn() }));

const msg = (id: string, created_at: number, extra: Partial<TeamMailboxMessage> = {}): TeamMailboxMessage => ({
  id, team_id: 'ct1', from_agent_id: 'lead', to_agent_id: 'w1', msg_type: 'message', content: id,
  summary: null, files: [], read: false, created_at, ...extra,
});

const task = (id: string, created_at: number, extra: Partial<TeamTask> = {}): TeamTask => ({
  id, team_id: 'ct1', subject: id, description: null, status: 'pending', owner: 'w1',
  blocked_by: [], blocks: [], created_at, updated_at: created_at, ...extra,
});

const page = (items: ActivityPage['items'], has_more = false, next?: { ts: number; id: string }): ActivityPage =>
  ({ items, has_more, next_cursor: next ?? null });

const item = (m: TeamMailboxMessage): ActivityPage['items'][number] => ({ kind: 'message', created_at: m.created_at, id: m.id, message: m });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

let host: HTMLDivElement, root: Root;

function Harness({ direction = 'desc' as 'desc' | 'asc' }) {
  const feed = useTeamActivityFeed('ct1', true, direction, 'all');
  return (
    <>
      <span data-testid="messages">{[...feed.messages].sort((a, b) => a.id.localeCompare(b.id)).map((m) => `${m.id}:${m.read ? 'read' : 'unread'}`).join(',')}</span>
      <span data-testid="tasks">{[...feed.tasks].sort((a, b) => a.id.localeCompare(b.id)).map((t) => `${t.id}:${t.status}`).join(',')}</span>
      <span data-testid="more">{String(feed.hasMore)}</span>
      <span data-testid="error">{feed.error}</span>
      <button type="button" onClick={feed.loadMore}>加载更多</button>
      <button type="button" data-testid="retry" onClick={feed.retry}>重试</button>
    </>
  );
}

const text = (id: string) => host.querySelector(`[data-testid="${id}"]`)?.textContent;
const render = async (direction: 'desc' | 'asc' = 'desc') => {
  await act(async () => { root.render(<Harness direction={direction} />); });
  await act(async () => { await Promise.resolve(); });
};

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(api).mockReset();
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
});

it('D33-AC-1: 下一页按 id 合并去重，重复条目用新数据覆盖', async () => {
  vi.mocked(api)
    .mockResolvedValueOnce(page([item(msg('a', 1)), item(msg('b', 2))], true, { ts: 2, id: 'b' }))
    .mockResolvedValueOnce(page([item(msg('b', 2, { read: true })), item(msg('c', 3))]));
  await render();
  expect(text('messages')).toBe('a:unread,b:unread');
  expect(text('more')).toBe('true');

  await act(async () => { host.querySelector('button')!.click(); });
  await act(async () => { await Promise.resolve(); });

  expect(text('messages')).toBe('a:unread,b:read,c:unread');
  expect(text('more')).toBe('false');
  const second = String(vi.mocked(api).mock.calls[1]?.[1]);
  expect(second).toContain('limit=100');
  expect(second).toContain('direction=desc');
  expect(second).toContain('cursor_ts=2');
  expect(second).toContain('cursor_id=b');
});

it('D33-AC-2: 切换方向后旧响应被丢弃，不覆盖新结果', async () => {
  const first = deferred<ActivityPage>();
  const second = deferred<ActivityPage>();
  vi.mocked(api).mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);

  await act(async () => { root.render(<Harness direction="desc" />); });
  await act(async () => { root.render(<Harness direction="asc" />); });

  await act(async () => { first.resolve(page([item(msg('old', 1))])); await first.promise; });
  expect(text('messages')).toBe('');

  await act(async () => { second.resolve(page([item(msg('new', 2))])); await second.promise; });
  expect(text('messages')).toBe('new:unread');
});

it('D33-AC-8: 实时事件原位更新、窗口内插入，窗口外的旧条目被忽略', async () => {
  vi.mocked(api).mockResolvedValueOnce(page([item(msg('m1', 100))]));
  await render();

  act(() => emitActivityEvent('team.mailboxChanged', { team_id: 'ct1', message: msg('m2', 200) }));
  expect(text('messages')).toBe('m1:unread,m2:unread');

  act(() => emitActivityEvent('team.mailboxChanged', { team_id: 'ct1', message: msg('m2', 200, { read: true }) }));
  expect(text('messages')).toBe('m1:unread,m2:read');

  act(() => emitActivityEvent('team.mailboxChanged', { team_id: 'ct1', message: msg('m0', 50) }));
  expect(text('messages')).toBe('m1:unread,m2:read');

  act(() => emitActivityEvent('team.taskChanged', { team_id: 'ct1', task: task('t1', 300) }));
  expect(text('tasks')).toBe('t1:pending');

  act(() => emitActivityEvent('team.taskChanged', { team_id: 'other', task: task('t2', 400) }));
  expect(text('tasks')).toBe('t1:pending');
  expect(vi.mocked(api)).toHaveBeenCalledTimes(1);
});

it('D33-AC-9: 请求失败显示错误，重试重新拉取', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('核心服务没有响应')).mockResolvedValueOnce(page([item(msg('m1', 1))]));
  await render();
  expect(text('error')).toContain('核心服务没有响应');
  expect(text('messages')).toBe('');

  await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="retry"]')!.click(); });
  await act(async () => { await Promise.resolve(); });

  expect(text('error')).toBe('');
  expect(text('messages')).toBe('m1:unread');
  expect(vi.mocked(api)).toHaveBeenCalledTimes(2);
});

it('D33: 残缺的实时事件不进入看板', async () => {
  vi.mocked(api).mockResolvedValueOnce(page([]));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await render();
  act(() => emitActivityEvent('team.mailboxChanged', { team_id: 'ct1' }));
  expect(text('messages')).toBe('');
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});
