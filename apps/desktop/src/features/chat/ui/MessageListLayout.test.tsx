import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { S, update } from '@/state/store';
import type { Msg } from '@/state/types';
import { MessageList } from './MessageList';

/* UI-AUDIT-05 F-10 / F-11 / F-12：运行中的工具组、卡片缩进与文件变更卡片的位置 */

let host: HTMLDivElement, root: Root;
const render = async (msgs: Msg[]) => { await act(async () => root.render(<MessageList msgs={msgs} ctxId="conv:lead" />)); };
const user = (id: string): Msg => ({ id, type: 'user', at: 1, text: '整理脚本' });
const write = (id: string, path: string): Msg => ({ id, type: 'tool', at: 2, status: 'done', tool: '写入文件', toolName: 'Write', detail: path });
const files = (...paths: string[]): Msg => ({ id: 'files', type: 'files', at: 3, changes: paths.map(path => ({ path, add: 2, del: 1 })) });
const openGroups = () => [...host.querySelectorAll('.tools')].map(group => !!group.querySelector('.tools__list'));

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  S.eventOpen = {}; S.running = {};
  S.convs = [{ id: 'lead', owner: 'pc', title: 'Leader', updated: 1, messages: [], remote: true }];
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('UI-AUDIT-05 F-10 finished groups of the running turn stay open and collapse together when the turn ends', async () => {
  const msgs: Msg[] = [
    user('u0'), write('old1', 'a'), write('old2', 'b'), { id: 'r0', type: 'assistant', at: 2, text: '上一轮完成' },
    user('u1'), write('t1', 'a'), write('t2', 'b'), { id: 'r1', type: 'assistant', at: 4, text: '继续' }, write('t3', 'c'), write('t4', 'd'),
  ];
  S.running = { lead: true };
  await render(msgs);
  expect(openGroups()).toEqual([false, true, true]);
  await act(async () => update(s => { s.running = {}; }));
  expect(openGroups()).toEqual([false, false, false]);
});

it('UI-AUDIT-05 F-10 a group the user closed stays closed while the turn keeps running', async () => {
  S.running = { lead: true };
  await render([user('u'), write('t1', 'a'), write('t2', 'b')]);
  await act(async () => host.querySelector<HTMLButtonElement>('.tools__head')!.click());
  expect(openGroups()).toEqual([false]);
  await act(async () => update());
  expect(openGroups()).toEqual([false]);
});

it('UI-AUDIT-05 F-11 cards sit in the reply column; tool and activity groups indent themselves without a second wrapper', async () => {
  await render([
    user('u'), { id: 'r', type: 'assistant', at: 2, text: '先写脚本' }, write('t0', 'x.sh'), write('t1', 'a.sh'), files('a.sh'),
    { id: 'p', type: 'approval', at: 4, status: 'approved', command: 'rm -rf build' },
  ]);
  const approval = [...host.querySelectorAll('.event')].find(el => !el.closest('.activity'))!;
  expect(approval.parentElement?.classList.contains('msg__body')).toBe(true);
  expect(approval.parentElement?.previousElementSibling?.classList.contains('msg__gutter')).toBe(true);
  // 执行过程（工具 + 文件改动）自己按 --msg-indent 缩进，不再包进头像列结构
  const activity = host.querySelector('.activity')!;
  expect(activity.closest('.msg__body')).toBeNull();
  await act(async () => activity.querySelector<HTMLButtonElement>('.activity__head')!.click());
  expect(activity.querySelector('.activity__files .event')?.closest('.msg__body')).toBeNull();
  const bubble = host.querySelector('.msg--user')!;
  expect(bubble.parentElement).toBe(host);
  expect(bubble.closest('.msg__body')).toBeNull();
});

it('UI-AUDIT-05 F-11 a plain tool group is not wrapped in the reply column either', async () => {
  await render([user('u'), write('t1', 'a'), write('t2', 'b')]);
  expect(host.querySelector('.tools')!.closest('.msg__body')).toBeNull();
});

it('UI-AUDIT-05 F-12 (superseded by CHAT-ACTIVITY-01 AC-10) a file change between tools stays in one activity in time order', async () => {
  await render([user('u'), write('t1', 'a.sh'), files('scripts/a.sh', 'scripts/b.sh'), write('t2', 'b.sh'), { id: 'r', type: 'assistant', at: 4, text: '都写好了' }]);
  const groups = host.querySelectorAll('.activity');
  expect(groups).toHaveLength(1);
  expect(groups[0].querySelector('.activity__head')?.textContent).toContain('执行工具 2 次');
  expect(groups[0].querySelector('.activity__changes')?.textContent).toBe('修改 2 个文件');
  const reply = [...host.querySelectorAll('.msg__text')].find(el => el.textContent === '都写好了')!;
  expect(groups[0].compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('UI-AUDIT-05 F-10 an activity group of the running turn stays open after its tools finish and closes when the turn ends', async () => {
  S.running = { lead: true };
  const msgs: Msg[] = [user('u'), { id: 'th', type: 'thinking', at: 2, text: '想' }, write('t1', 'a'), { id: 'r', type: 'assistant', at: 3, text: '继续' }];
  await render(msgs);
  expect(host.querySelector('.activity__head')?.getAttribute('aria-expanded')).toBe('true');
  await act(async () => update(s => { s.running = {}; }));
  expect(host.querySelector('.activity__head')?.getAttribute('aria-expanded')).toBe('false');
});
