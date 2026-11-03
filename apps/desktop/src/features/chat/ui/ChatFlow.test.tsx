import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { Msg } from '@/state/types';

vi.mock('./Composer', () => ({ Composer: () => <div data-testid="composer" /> }));

import { Chat } from './Chat';

/* UI-AUDIT-05 F-09：整轮运行期间「正在等待回复」行一直挂着，内容切换时对话区不跳动 */

let host: HTMLDivElement, root: Root;
const messages = () => S.convs[0].messages;
const step = (fn: (list: Msg[]) => void) => act(async () => update(() => fn(messages())));
const status = () => host.querySelector('.reply-pending [role="status"]');

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  S.convs = [{ id: 'flow', owner: 'pc', title: '整理脚本', updated: 1, remote: true, loaded: true,
    messages: [{ id: 'u', type: 'user', at: 1, text: '整理脚本' }] }];
  S.activeConv = 'flow'; S.running = { flow: true }; S.eventOpen = {};
  await act(async () => root.render(<Chat />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('UI-AUDIT-05 F-09 the same pending row persists from thinking through tools, file card and reply, announcing only changes of meaning', async () => {
  const pending = host.querySelector('.reply-pending'), region = status();
  expect(pending).not.toBeNull();
  const announced: string[] = [];
  const expectSteady = (visible: boolean, text: string) => {
    expect(host.querySelector('.reply-pending')).toBe(pending);
    expect(status()).toBe(region);
    expect(status()?.textContent).toBe(text);
    if (announced.at(-1) !== text) announced.push(text);
    expect(!!host.querySelector('.reply-pending__live .typing')).toBe(visible);
    expect(host.querySelectorAll('.msg__name')).toHaveLength(1);
  };
  expectSteady(true, '正在等待回复…');
  await step(list => list.push({ id: 'th', type: 'thinking', at: 2, text: '先看目录', streaming: true }));
  expectSteady(false, '正在等待回复…');
  await step(list => { delete list[1].streaming; list.push({ id: 't1', type: 'tool', at: 3, tool: '写入文件', toolName: 'Write', status: 'running' }); });
  expectSteady(false, '正在等待回复…');
  await step(list => { list[2].status = 'done'; });
  expectSteady(true, '正在等待回复…');
  await step(list => list.push({ id: 't2', type: 'tool', at: 4, tool: '写入文件', toolName: 'Write', status: 'running' }));
  expectSteady(false, '正在等待回复…');
  await step(list => { list[3].status = 'done'; list.push({ id: 'f', type: 'files', at: 5, changes: [{ path: 'a.sh', add: 3, del: 0 }] }); });
  expectSteady(true, '正在等待回复…');
  await step(list => list.push({ id: 'a', type: 'assistant', at: 6, text: '写好了', streaming: true }));
  expectSteady(false, '正在继续处理…');
  await step(list => { delete list[5].streaming; });
  expectSteady(true, '正在继续处理…');
  // 多次停顿只改可见动画；读屏区域的文字只变过一次
  expect(announced).toEqual(['正在等待回复…', '正在继续处理…']);
  expect(status()?.hasAttribute('aria-hidden')).toBe(false);
  expect(host.querySelector('.reply-pending__live')?.getAttribute('aria-hidden')).toBe('true');
});

it('UI-AUDIT-05 F-09 the pending row leaves in the same render that shows the turn actions', async () => {
  await step(list => list.push({ id: 'a', type: 'assistant', at: 2, text: '完成' }));
  expect(host.querySelector('.reply-pending')).not.toBeNull();
  expect(host.querySelector('.msg--actions')).toBeNull();
  await act(async () => update(s => { delete s.running.flow; }));
  expect(host.querySelector('.reply-pending')).toBeNull();
  expect(host.querySelectorAll('.msg--actions')).toHaveLength(1);
});
