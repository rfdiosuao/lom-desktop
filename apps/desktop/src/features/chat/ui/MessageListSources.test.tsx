import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { MessageList } from './MessageList';
import type { Msg } from '@/state/types';

const open = vi.fn();
vi.mock('@/core/links', () => ({ openExternalUrl: async (...args: unknown[]) => { open(...args); } }));

const output = JSON.stringify({
  success: true,
  data: {
    result: {
      query: '麓鸣',
      results: [{ title: '示例文章', url: 'https://example.com/a', site: 'example.com' }],
    },
  },
});

const search: Msg = {
  id: 'm1', type: 'tool', at: 1, callId: 'c1', tool: 'lom_search',
  toolName: 'mcp__lom-search__lom_search', status: 'done', output,
};

let host: HTMLDivElement, root: Root;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  open.mockReset();
  S.eventOpen = {};
  S.convs = [{ id: 'cb1', owner: 'pc', title: 'CodeBuddy', updated: 1, messages: [], remote: true, agentId: 'ag_cb', agentName: 'CodeBuddy' }];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('D31 AC-9 team member conversations show, expand and open search sources', async () => {
  await act(async () => root.render(<MessageList msgs={[search]} ctxId="conv:cb1" />));
  expect(host.querySelectorAll('.src-chip')).toHaveLength(1);

  const bar = host.querySelector('.search-sources__bar') as HTMLButtonElement;
  await act(async () => { bar.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
  const link = host.querySelector('.search-sources__link') as HTMLAnchorElement;
  expect(link.getAttribute('href')).toBe('https://example.com/a');

  await act(async () => { link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
  expect(open).toHaveBeenCalledWith('https://example.com/a');
});

it('D31 AC-2 keeps searches separated by other messages in their own groups', async () => {
  await act(async () => root.render(<MessageList msgs={[
    search,
    { id: 'a1', type: 'assistant', at: 2, text: '中间回复' },
    { ...search, id: 'm2', callId: 'c2' },
  ]} ctxId="conv:cb1" />));
  expect(host.querySelectorAll('.search-sources')).toHaveLength(2);
  expect(host.querySelectorAll('.src-chip')).toHaveLength(2);
});
