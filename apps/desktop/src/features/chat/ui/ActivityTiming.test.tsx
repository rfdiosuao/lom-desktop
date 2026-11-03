import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Msg } from '@/state/types';
import { MessageList } from './MessageList';

let host: HTMLDivElement, root: Root;
const render = async (msgs: Msg[]) => act(async () => root.render(<MessageList msgs={msgs} ctxId="conv:timing" />));
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.useFakeTimers(); vi.setSystemTime(10_000);
  S.eventOpen = {}; S.running = {}; S.convs = [{ id: 'timing', owner: 'pc', title: '计时', updated: 1, messages: [], remote: true }];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
const tool = (id: string, timing?: { startedAt: number; endedAt?: number }, status: Msg['status'] = 'done'): Msg => ({ id, type: 'tool', at: 1, timing, status, tool: '运行命令', command: 'ls' } as Msg);

it('CHAT-ACTIVITY-01 AC-8 live elapsed updates without new events and freezes at the observed completion', async () => {
  const m = tool('live', { startedAt: 8_000 }, 'running');
  await render([m]); expect(host.querySelector('.tool__elapsed')?.textContent).toBe('2 秒');
  expect(host.querySelector('.tool__elapsed')?.getAttribute('aria-label')).toBeNull();
  expect(host.querySelector('.tool__elapsed')?.getAttribute('title')).toMatch(/^已运行 2 秒/);
  await act(async () => vi.advanceTimersByTime(3_000));
  expect(host.querySelector('.tool__elapsed')?.textContent).toBe('5 秒');
  await render([tool('live', { startedAt: 8_000, endedAt: 13_200 })]);
  expect(host.querySelector('.tool__elapsed')?.textContent).toBe('5.2 秒');
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(host.querySelector('.tool__elapsed')?.textContent).toBe('5.2 秒');
  expect(vi.getTimerCount()).toBe(0);
});

it('CHAT-ACTIVITY-01 AC-8 group uses wall time instead of adding overlapping tools and remains visible collapsed', async () => {
  await render([{ id: 'think', type: 'thinking', at: 1, timing: { startedAt: 1_000, endedAt: 2_000 } } as Msg,
    tool('a', { startedAt: 2_000, endedAt: 8_000 }), tool('b', { startedAt: 3_000, endedAt: 9_000 })]);
  expect(host.querySelector('.activity__head .tool__elapsed')?.textContent).toBe('用时 8 秒');
  await act(async () => host.querySelector<HTMLButtonElement>('.activity__head')!.click());
  expect(host.querySelector('.activity__head .tool__elapsed')?.textContent).toBe('用时 8 秒');
});

it('CHAT-ACTIVITY-01 AC-9 incomplete old timestamps never invent a duration', async () => {
  await render([tool('old')]);
  expect(host.querySelector('.tool__elapsed')?.textContent).toBe('耗时未知');
  await render([tool('stopped-without-end', { startedAt: 1_000 }, 'error')]);
  expect(host.querySelector('.tool__elapsed')?.textContent).toBe('耗时未知');
  expect(vi.getTimerCount()).toBe(0);
});
