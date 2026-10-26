import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreMessage } from '@/core/types';
import type { Conv } from '@/state/types';

const api = vi.fn();
vi.mock('@/core/client', () => ({ api: (...args: unknown[]) => api(...args) }));
const { loadHistory } = await import('./history');
const c: Conv = { id: 'long', owner: 'pc', title: '长任务', updated: 0, remote: true, messages: [] };
const row = (n: number): CoreMessage => ({
  id: `row-${n}`, msg_id: `msg-${n}`, conversation_id: c.id, type: 'text', position: 'left',
  created_at: 1, content: { content: `第 ${n} 条` },
});

beforeEach(() => api.mockReset());

describe('D26 完整恢复长会话', () => {
  it('超过 200 条时按核心游标加载全部页，维持同时间戳记录的服务端顺序', async () => {
    const items = Array.from({ length: 451 }, (_, index) => row(index));
    api.mockResolvedValueOnce({ items: items.slice(251), oldest_cursor: 'v1.latest+/=', has_more_before: true })
      .mockResolvedValueOnce({ items: items.slice(51, 251), oldest_cursor: 'v1.older', has_more_before: true })
      .mockResolvedValueOnce({ items: items.slice(0, 51), has_more_before: false });
    const { messages } = await loadHistory(c);
    expect(messages.map(m => m.text)).toEqual(items.map(item => item.content.content));
    expect(api.mock.calls.map(call => call[1])).toEqual([
      '/api/conversations/long/messages?limit=200',
      '/api/conversations/long/messages?limit=200&before=v1.latest%2B%2F%3D',
      '/api/conversations/long/messages?limit=200&before=v1.older',
    ]);
  });

  it('相邻页意外重叠时每条记录只显示一次', async () => {
    api.mockResolvedValueOnce({ items: [row(2), row(3)], oldest_cursor: 'older', has_more_before: true })
      .mockResolvedValueOnce({ items: [row(1), row(2)], has_more_before: false });
    const { messages } = await loadHistory(c);
    expect(messages.map(m => m.text)).toEqual(['第 1 条', '第 2 条', '第 3 条']);
  });

  it.each([
    { items: [row(1)], has_more_before: true },
    { items: [], oldest_cursor: 'empty', has_more_before: true },
  ])('分页缺少有效下一页时明确失败，不能把部分记录当作完整历史', async page => {
    api.mockResolvedValue(page);
    await expect(loadHistory(c)).rejects.toThrow('chat.history_pagination');
  });

  it('核心重复返回同一游标时终止，避免无限请求', async () => {
    api.mockResolvedValue({ items: [row(1)], oldest_cursor: 'loop', has_more_before: true });
    await expect(loadHistory(c)).rejects.toThrow('chat.history_pagination');
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('旧页加载失败时向调用者报告失败，不返回截断的成功结果', async () => {
    api.mockResolvedValueOnce({ items: [row(3)], oldest_cursor: 'older', has_more_before: true })
      .mockRejectedValueOnce(new Error('core.offline'));
    await expect(loadHistory(c)).rejects.toThrow('core.offline');
  });
});
