import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import { MessageList } from './MessageList';
import type { Msg } from '@/state/types';

let host: HTMLDivElement, root: Root;
const render = async (msgs: Msg[]) => { await act(async () => root.render(<MessageList msgs={msgs} ctxId="conv:lead" />)); return host; };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  S.eventOpen = {};
  S.convs = [{ id: 'lead', owner: 'pc', title: 'Leader', updated: 1, messages: [], remote: true },
    { id: 'cb1', owner: 'pc', title: 'CodeBuddy', updated: 1, messages: [], remote: true, agentId: 'ag_cb', agentName: 'CodeBuddy' }];
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const tool = (id: string, extra: Partial<Msg>): Msg => ({ id, type: 'tool', at: 1, status: 'done', ...extra });

it('consecutive tool calls fold into one group with one sentence per call', async () => {
  await render([
    { id: 'u', type: 'user', at: 1, text: '整理应用列表' },
    tool('t1', { tool: '运行命令', toolName: 'Bash', detail: 'sleep 8', command: 'sleep 8' }),
    tool('t2', { tool: 'agent_task_read', toolName: 'agent_task_read', args: { task_id: 'cb1' } }),
    tool('t3', { tool: 'agent_task_start', toolName: 'agent_task_start', args: { agent: 'ag:CodeBuddy', text: '整理完整的 app 列表' } }),
  ]);
  const head = host.querySelector<HTMLButtonElement>('.tools__head')!;
  expect(head.textContent).toContain('运行了 1 条命令，调用了 2 个工具');
  expect(host.querySelector('.tools__list')).toBeNull(); // 跑完默认收起
  await act(async () => head.click());
  const rows = [...host.querySelectorAll('.tool__text')].map(x => x.textContent);
  expect(rows).toEqual(['运行命令：sleep 8', '读取CodeBuddy的任务结果', '派任务给 CodeBuddy：整理完整的 app 列表']);
  expect(host.textContent).not.toContain('agent_task_read');
});

it('a running group stays open so progress is visible', async () => {
  await render([tool('a', { tool: '运行命令', detail: 'ls' }), tool('b', { tool: '运行命令', detail: 'sleep 15', status: 'running' })]);
  expect(host.querySelectorAll('.tool__row')).toHaveLength(2);
});

it('the speaker name shows once per turn, not after every tool call', async () => {
  await render([
    { id: 'u', type: 'user', at: 1, text: '让 CodeBuddy 整理' },
    { id: 'a1', type: 'assistant', at: 2, text: '我把列表打包发过去。' },
    tool('t1', { tool: '运行命令', detail: 'ls' }),
    { id: 'a2', type: 'assistant', at: 3, text: '派出去等结果。' },
    { id: 'u2', type: 'user', at: 4, text: '好' },
    { id: 'a3', type: 'assistant', at: 5, text: '收到。' },
  ]);
  expect(host.querySelectorAll('.msg__name')).toHaveLength(2);
  expect(host.querySelectorAll('.msg--cont')).toHaveLength(1);
});

it('Lom puts identity before thinking and preserves interleaved reply order', async () => {
  const msgs: Msg[] = [
    { id: 'think', type: 'thinking', at: 1, text: '先检查情况', status: 'running' },
    { id: 'answer', type: 'assistant', at: 2, text: '开始检查' },
    tool('check', { tool: '运行命令', command: 'ls' }),
    { id: 'final', type: 'assistant', at: 3, text: '检查完成' },
  ];
  await render(msgs);
  const header = host.querySelector('.msg__meta')!;
  const thinking = host.querySelector<HTMLButtonElement>('.lom-thinking__head')!;
  expect(thinking).not.toBeNull();
  expect(header.compareDocumentPosition(thinking) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(host.querySelectorAll('.msg__name')).toHaveLength(1);
  expect(thinking.getAttribute('aria-expanded')).toBe('false');
  expect(host.textContent).not.toContain('先检查情况');
  await act(async () => thinking.click());
  expect(host.textContent).toContain('先检查情况');
  expect([...host.querySelectorAll('.msg__text:not(.lom-thinking__body), .tools')].map(e => e.textContent)).toEqual(['开始检查', '运行命令', '检查完成']);
});

it('D31 AC-1 external agents use the same compact thinking below their identity', async () => {
  await act(async () => root.render(<MessageList ctxId="conv:cb1" msgs={[
    { id: 'think', type: 'thinking', at: 1, text: '外部思考' },
    { id: 'reply', type: 'assistant', at: 2, text: '外部回复' },
  ]} />));
  const thinking = host.querySelector('.lom-thinking')!;
  expect(thinking).not.toBeNull();
  expect(host.querySelector('.event')).toBeNull();
  expect(host.querySelector('.msg__name')?.textContent).toBe('CodeBuddy');
  expect(host.querySelectorAll('.msg__name')).toHaveLength(1);
  expect(host.querySelector('.msg__meta')!.compareDocumentPosition(thinking) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(host.textContent).not.toContain('外部思考');
});

it('streamed Lom identity stays singular and thinking settles when text arrives', async () => {
  const thinking: Msg = { id: 'live', type: 'thinking', agent: 'pc', at: 1, streaming: true, text: '分析中' };
  await render([thinking]);
  expect(host.textContent).toContain('正在思考');
  await render([thinking, { id: 'response', type: 'assistant', agent: 'pc', at: 2, streaming: true, text: '答复' }]);
  expect(host.querySelectorAll('.msg__name')).toHaveLength(1);
  expect(host.textContent).not.toContain('正在思考');
  expect(host.textContent).toContain('思考过程');
  expect(host.querySelector('[title="思考已完成"]')).not.toBeNull();
  expect(host.querySelector('.lom-thinking .spinner')).toBeNull();
});

it('D26 AC-1: streaming updates keep the running indicator mounted', async () => {
  const thinking: Msg = { id: 'motion', type: 'thinking', at: 1, streaming: true, text: '分析' };
  await render([thinking]);
  const spinner = host.querySelector('.lom-thinking .spinner');
  expect(spinner).not.toBeNull();
  for (let i = 0; i < 8; i++) {
    await act(async () => update(() => { thinking.text += '。'; }));
    expect(host.querySelector('.lom-thinking .spinner')).toBe(spinner);
  }
  const running = tool('running', { status: 'running', command: 'example', output: '' });
  await render([running]);
  const toolSpinner = host.querySelector('.tool__state .spinner');
  expect(toolSpinner).not.toBeNull();
  for (let i = 0; i < 8; i++) {
    await act(async () => update(() => { running.output += '.'; }));
    expect(host.querySelector('.tool__state .spinner')).toBe(toolSpinner);
  }
});

it('review: reply display and copy both omit the internal completion marker', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    await render([{ id: 'done', type: 'assistant', at: 1, text: '已完成。\n[LOM_GOAL_DONE:42]' }]);
    expect(host.querySelector('.msg__text')?.textContent).toBe('已完成。');
    const copy = host.querySelector<HTMLButtonElement>('button[aria-label="复制"], button[title="复制"]')!;
    await act(async () => copy.click());
    expect(writeText).toHaveBeenCalledWith('已完成。');
  } finally {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});
