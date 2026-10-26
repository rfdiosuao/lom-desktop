import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { S } from '@/state/store';
import { ToolCalls } from './ToolCalls';
import { mapHistory } from '../runtime/history';
import type { Conv, Msg } from '@/state/types';
import type { CoreMessage } from '@/core/types';

const output = JSON.stringify({
  source: 'Lom web search',
  untrusted_web_content: true,
  result: {
    query: '麓鸣',
    results: [
      { title: '示例文章', url: 'https://example.com/a', site: 'example.com' },
      { title: '另一篇', url: 'https://news.example.org/b', site: 'news' },
    ],
  },
  billable: true,
});

const searchOutput = (urls: string[]) => JSON.stringify({
  result: { query: '麓鸣', results: urls.map(url => ({ title: url, url, site: new URL(url).hostname })) },
});

const tool = (id: string, extra: Partial<Msg>): Msg => ({ id, type: 'tool', at: 1, status: 'done', ...extra });

let host: HTMLDivElement, root: Root;

const render = async (items: Msg[]) => { await act(async () => root.render(<ToolCalls items={items} ctxId="conv:c1" />)); };

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  S.eventOpen = {};
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('D31 AC-3 工具组与来源条', () => {
  it('keeps the sources visible while a multi-call group is collapsed', async () => {
    await render([
      tool('t1', { tool: '联网搜索', toolName: 'LomWebSearch', detail: '麓鸣', output }),
      tool('t2', { tool: '运行命令', toolName: 'Bash', detail: 'ls' }),
    ]);
    expect(host.querySelector('.tools__head')).not.toBeNull();
    expect(host.querySelector('.tools__list')).toBeNull();
    expect(host.querySelectorAll('.src-chip')).toHaveLength(2);

    await act(async () => (host.querySelector('.tools__head') as HTMLButtonElement).click());
    expect(host.querySelector('.tools__list')).not.toBeNull();
    expect(host.querySelectorAll('.src-chip')).toHaveLength(2);
  });

  it('keeps the failure count and hides the bar when a search has no sources', async () => {
    await render([
      tool('t1', { tool: '联网搜索', toolName: 'LomWebSearch', status: 'error', output: '{"error":"boom"}' }),
      tool('t2', { tool: '运行命令', toolName: 'Bash', detail: 'ls', status: 'error' }),
    ]);
    expect(host.querySelector('.tools__head')?.textContent).toContain('2 个失败');
    expect(host.querySelector('.search-sources')).toBeNull();
  });

  it('merges consecutive searches by URL without repeating chips', async () => {
    await render([
      tool('s1', { toolName: 'LomWebSearch', output: searchOutput(['https://a.example/1', 'https://b.example/1']) }),
      tool('s2', { toolName: 'LomWebSearch', output: searchOutput(['https://b.example/1', 'https://c.example/1']) }),
    ]);
    const chips = [...host.querySelectorAll('.src-chip__name')].map(x => x.textContent);
    expect(chips).toEqual(['a.example', 'b.example', 'c.example']);
  });
});

describe('D31 AC-8 历史回放', () => {
  it('restores the sources from the same stored output', async () => {
    const conv: Conv = { id: 'c1', owner: 'pc', title: '任务', updated: 1, messages: [], remote: true };
    const records: CoreMessage[] = [
      {
        id: 'h1', msg_id: 'x1', conversation_id: 'c1', type: 'tool_call',
        content: { call_id: 'call-1', name: 'LomWebSearch', args: { query: '麓鸣' }, output, status: 'completed' },
        created_at: 1,
      },
      {
        id: 'h2', msg_id: 'x2', conversation_id: 'c1', type: 'tool_call',
        content: { call_id: 'call-2', name: 'LomWebSearch', args: { query: '麓鸣 2' }, output: searchOutput(['https://news.example.org/b', 'https://third.example/c']), status: 'completed' },
        created_at: 2,
      },
    ];
    const { messages } = mapHistory(records, conv);
    await render(messages);
    expect(host.querySelectorAll('.src-chip')).toHaveLength(3);
    expect(host.textContent).toContain('example.com');
    expect(host.textContent).toContain('news');
    expect(host.textContent).toContain('third.example');
  });
});
