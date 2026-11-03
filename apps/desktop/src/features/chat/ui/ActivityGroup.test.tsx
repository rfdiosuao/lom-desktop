import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { S } from '@/state/store';
import type { Msg } from '@/state/types';
import { MessageList } from './MessageList';

let host: HTMLDivElement, root: Root;
const thought = (id: string): Msg => ({ id, type: 'thinking', text: `分析 ${id}`, at: 1 });
const tool = (id: string, status: Msg['status'] = 'done'): Msg => ({ id, type: 'tool', at: 1, status, toolName: 'Bash', tool: '运行命令', command: 'gh repo view owner/repo', detail: 'gh repo view owner/repo' });
const render = async (msgs: Msg[]) => act(async () => root.render(<MessageList msgs={msgs} ctxId="conv:activity" />));
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  S.eventOpen = {}; S.running = {};
  S.convs = [{ id: 'activity', owner: 'pc', title: '操作', updated: 1, messages: [], remote: true }];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('CHAT-ACTIVITY-01 AC-1/2 groups alternating activity and exposes every thought through one entry', async () => {
  await render([thought('a'), tool('one'), thought('b'), tool('two'), thought('c'), { id: 'reply', type: 'assistant', text: '完成答复', at: 2 }]);
  const group = host.querySelector('[role="group"][aria-label="执行过程"]')!;
  expect(group).not.toBeNull(); expect(host.querySelectorAll('[aria-label="执行过程"]')).toHaveLength(1);
  // 已结束的过程默认收起，不留空白工具条；展开后看到每一行
  expect(group.querySelector('.activity__head')?.getAttribute('aria-expanded')).toBe('false');
  expect(group.querySelector('.tools')).toBeNull();
  await act(async () => group.querySelector<HTMLButtonElement>('.activity__head')!.click());
  expect(group.querySelectorAll('.tool__row')).toHaveLength(2);
  expect(group.querySelectorAll('.lom-thinking__head')).toHaveLength(1);
  expect(host.querySelectorAll('.msg__name')).toHaveLength(1);
  await act(async () => group.querySelector<HTMLButtonElement>('.lom-thinking__head')!.click());
  expect(group.textContent).toContain('分析 a'); expect(group.textContent).toContain('分析 b'); expect(group.textContent).toContain('分析 c');
  expect(group.compareDocumentPosition(host.querySelector('.msg--cont')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('CHAT-ACTIVITY-01 AC-2/3 preserves collapse across updates while exposing failures and keeping approvals outside', async () => {
  const msgs = [thought('a'), tool('one', 'running')];
  await render(msgs);
  const head = host.querySelector<HTMLButtonElement>('.activity__head')!;
  expect(head).not.toBeNull();
  await act(async () => head.click());
  expect(head.getAttribute('aria-expanded')).toBe('false');
  await render([...msgs, thought('b'), tool('two', 'error'), { id: 'approval', type: 'approval', at: 2, status: 'pending', command: 'write file' }]);
  expect(host.querySelector('.activity__head')?.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('.activity')?.textContent).toContain('1 个失败');
  expect(host.querySelector('.activity .tool.is-error')).not.toBeNull();
  expect(host.querySelector('.activity .event--warn')).toBeNull();
  expect(host.textContent).toContain('需要你的确认');
});

it('CHAT-ACTIVITY-01 AC-1 does not move assistant commentary or merge separate user turns', async () => {
  await render([thought('a'), tool('one'), { id: 'comment', type: 'assistant', at: 2, text: '中途说明' }, thought('b'), tool('two'), { id: 'user', type: 'user', at: 3, text: '下一轮' }, thought('c'), tool('three')]);
  expect(host.querySelectorAll('[aria-label="执行过程"]')).toHaveLength(3);
  const nodes = [...host.querySelectorAll('.activity, .msg__text, .msg--user')].map(e => e.textContent);
  expect(nodes.findIndex(t => t?.includes('中途说明'))).toBeGreaterThan(nodes.findIndex(t => t?.includes('执行工具')));
});

it('CHAT-ACTIVITY-01 AC-4 tools with a known provider render a site logo alongside status', async () => {
  await render([tool('github')]);
  expect(host.querySelector('.tool__row img')?.getAttribute('src')).toBe('https://github.com/favicon.ico');
  expect(host.querySelector('.tool__state')?.getAttribute('title')).toBe('已完成');
});

it('CHAT-ACTIVITY-01 AC-3 retains search sources when collapsed and labels queued calls truthfully', async () => {
  await render([thought('a'), { ...tool('search'), toolName: 'LomWebSearch', tool: '联网搜索', command: '', output: JSON.stringify({ result: { results: [{ title: '文档', url: 'https://example.com/docs', site: 'example' }] } }) }, { ...tool('queue', 'queued'), toolName: 'WebFetch', args: { url: 'https://qoder.com/' } }]);
  expect(host.querySelector('.activity__head')?.textContent).toContain('等待中');
  // 收起时仍保留来源条；展开后排队的调用如实标为排队中
  expect(host.querySelector('.activity__head')?.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('.search-sources')).not.toBeNull();
  expect(host.querySelector('.search-sources')?.textContent).toContain('example');
  expect(host.querySelectorAll('.tool__row')).toHaveLength(0);
  await act(async () => host.querySelector<HTMLButtonElement>('.activity__head')!.click());
  expect(host.querySelector('.tool__state[title="排队中"]')).not.toBeNull();
});

it('CHAT-ACTIVITY-01 AC-2 keeps a tool-only group collapsed when streaming adds thinking', async () => {
  const msgs = [tool('one'), tool('two', 'running')];
  await render(msgs);
  await act(async () => host.querySelector<HTMLButtonElement>('.tools__head')!.click());
  expect(host.querySelector('.tools__head')?.getAttribute('aria-expanded')).toBe('false');
  await render([...msgs, thought('after')]);
  expect(host.querySelector('.activity__head')?.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelectorAll('.tool__row')).toHaveLength(0);
});

const fileChanges: Msg = { id: 'changes', type: 'files', at: 3_000, changes: [{ path: 'src/main.ts', add: 10, del: 2 }, { path: 'src/style.css', add: 8, del: 3 }] };

it('CHAT-ACTIVITY-01 AC-10 personal assistant file changes stay inside the activity without changing tool count or duration', async () => {
  S.convs[0].personal = { id: 'pa', name: '小麓', directory: '/pa' };
  await render([{ ...thought('a'), timing: { startedAt: 1_000, endedAt: 2_000 } },
    { ...tool('one'), timing: { startedAt: 2_000, endedAt: 3_000 } }, fileChanges,
    { ...tool('two'), timing: { startedAt: 3_000, endedAt: 5_000 } }]);
  const group = host.querySelector('.activity')!;
  expect(host.querySelectorAll('.activity')).toHaveLength(1);
  await act(async () => group.querySelector<HTMLButtonElement>('.activity__head')!.click());
  expect(group.querySelector('.activity__files')).not.toBeNull();
  expect(host.querySelector('.activity')!.contains(host.querySelector('.event')!)).toBe(true);
  expect(group.querySelector('.activity__head')?.textContent).toContain('执行工具 2 次');
  expect(group.querySelector('.activity__head .tool__elapsed')?.textContent).toBe('用时 4 秒');
  await act(async () => group.querySelector<HTMLButtonElement>('.event__head')!.click());
  expect(group.textContent).toContain('src/main.ts'); expect(group.textContent).toContain('src/style.css');
  expect([...group.querySelectorAll('.diff-row .add')].map(e => e.textContent)).toEqual(['+10', '+8']);
  expect([...group.querySelectorAll('.diff-row .del')].map(e => e.textContent)).toEqual(['−2', '−3']);
  expect([...group.querySelectorAll('button')].some(b => b.textContent === '在工作区查看')).toBe(true);
});

it('CHAT-ACTIVITY-01 AC-10 file-only history remains foldable when later tools arrive', async () => {
  await render([fileChanges]);
  const head = host.querySelector<HTMLButtonElement>('.activity__head')!;
  expect(head.getAttribute('aria-expanded')).toBe('false');
  await act(async () => head.click());
  expect(host.querySelector('.activity__files')).not.toBeNull();
  await act(async () => head.click());
  await render([fileChanges, tool('later')]);
  expect(host.querySelector('.activity__head')?.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('.activity__changes')?.textContent).toBe('修改 2 个文件');
  expect(host.querySelector('.activity__files')).toBeNull();
});

it('CHAT-ACTIVITY-01 AC-10 file changes do not pull approval into the activity', async () => {
  await render([thought('before'), tool('one'), fileChanges, { id: 'approve-files', type: 'approval', at: 4, status: 'pending' },
    thought('after'), tool('two'), { ...fileChanges, id: 'changes-2' }]);
  expect(host.querySelectorAll('.activity')).toHaveLength(2);
  expect(host.querySelector('.event--warn')).not.toBeNull();
  expect(host.querySelector('.activity .event--warn')).toBeNull();
});

it('CHAT-ACTIVITY-01 AC-2 a live group is open by default and closes by default once it finishes', async () => {
  const live = [thought('a'), tool('one', 'running')];
  await render(live);
  expect(host.querySelector('.activity__head')?.getAttribute('aria-expanded')).toBe('true');
  await render([thought('a'), tool('one')]);
  expect(host.querySelector('.activity__head')?.getAttribute('aria-expanded')).toBe('false');
});

const search = (id: string, url: string): Msg => ({ ...tool(id), toolName: 'LomWebSearch', tool: '联网搜索', command: '', output: JSON.stringify({ result: { results: [{ title: '文档', url, site: 'docs' }] } }) });
it('CHAT-ACTIVITY-01 AC-5 only sites returned by this turn\'s search load icons in replies and tool rows', async () => {
  await render([search('s', 'https://docs.example.com/a'),
    { id: 'r', type: 'assistant', at: 2, text: '[文档](https://docs.example.com/guide) [别处](https://elsewhere.example.net/)' },
    { id: 'u', type: 'user', at: 3, text: '下一轮' }, { id: 'r2', type: 'assistant', at: 4, text: '[文档](https://docs.example.com/guide)' }]);
  const [first, second] = [...host.querySelectorAll('.msg__text')].filter(x => x.querySelector('a'));
  expect([...first.querySelectorAll('a img')].map(x => x.getAttribute('src'))).toEqual(['https://docs.example.com/favicon.ico']);
  expect(second.querySelector('img')).toBeNull();
});
