import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { S } from '@/state/store';
import type { Msg } from '@/state/types';
import { MessageList } from './MessageList';
import { reconcileSendRegistrations, trackPendingSend } from '../runtime/cancel';

let host: HTMLDivElement, root: Root;
const render = async (msgs: Msg[], id = 'qoder') => {
  await act(async () => root.render(<MessageList msgs={msgs} ctxId={`conv:${id}`} />));
};
const answer: Msg = { id: 'answer', type: 'assistant', text: '**完成**\n\n- 检查通过\n\n```ts\nconst ok = true;\n```', at: 2 };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  S.running = {}; S.eventOpen = {};
  S.convs = [
    { id: 'qoder', owner: 'pc', agentId: 'qoder', agentName: 'Qoder', title: '任务', updated: 1, messages: [], remote: true },
    { id: 'lom', owner: 'pc', title: '任务', updated: 1, messages: [], remote: true },
    { id: 'phone', owner: 'dev_test', phoneSession: 'session', title: '手机', updated: 1, messages: [] },
  ];
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it.each(['qoder', 'lom'])('D31 AC-2 %s renders expanded thinking and reply through shared Markdown', async id => {
  const thought: Msg = { id: 'thought', type: 'thinking', text: answer.text, at: 1 };
  await render([thought, answer], id);
  const toggle = host.querySelector<HTMLButtonElement>('.lom-thinking__head');
  expect(toggle).not.toBeNull();
  await act(async () => toggle!.click());
  for (const selector of ['.lom-thinking__body', '.msg__text:not(.lom-thinking__body)']) {
    const body = host.querySelector(selector)!;
    expect(body.querySelector('b')?.textContent).toBe('完成');
    expect(body.querySelector('li')?.textContent).toBe('检查通过');
    expect(body.querySelector('pre code')?.textContent).toBe('const ok = true;');
  }
});

it('D31 AC-1 external streamed thinking keeps its spinner and identity until reply starts', async () => {
  const thought: Msg = { id: 'live', type: 'thinking', text: '分析', at: 1, streaming: true };
  await render([thought]);
  const spinner = host.querySelector('.lom-thinking .spinner');
  expect(spinner).not.toBeNull();
  await render([{ ...thought, text: '分析更多' }]);
  expect(host.querySelector('.lom-thinking .spinner')).toBe(spinner);
  await render([thought, { ...answer, streaming: true }]);
  expect(host.querySelectorAll('.msg__name')).toHaveLength(1);
  expect(host.querySelector('.msg__name')?.textContent).toBe('Qoder');
  expect(host.querySelector('.lom-thinking .spinner')).toBeNull();
  expect(host.querySelector('[title="思考已完成"]')).not.toBeNull();
});

it('D31 AC-3 external actions follow the final tool and appear only after the whole turn ends', async () => {
  const tool: Msg = { id: 'tool', type: 'tool', tool: '运行命令', command: 'pwd', at: 3, status: 'done' };
  S.running.qoder = true;
  await render([answer, tool]);
  expect(host.querySelector('.msg--actions')).toBeNull();
  S.running = {};
  await render([answer, tool]);
  expect(host.querySelectorAll('.msg--actions')).toHaveLength(1);
  expect(host.lastElementChild?.classList.contains('msg--actions')).toBe(true);
  expect(host.querySelector('.tools')!.compareDocumentPosition(host.querySelector('.msg--actions')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('D31 AC-3 the previous completed turn remains actionable while the next turn runs', async () => {
  S.running.qoder = true;
  await render([
    { id: 'u1', type: 'user', text: '第一问', at: 1 }, answer,
    { id: 'u2', type: 'user', text: '第二问', at: 3 },
    { id: 'next', type: 'assistant', text: '还在回复', streaming: true, at: 4 },
  ]);
  expect(host.querySelectorAll('.msg--actions')).toHaveLength(1);
  expect(host.querySelector('.msg--actions')!.compareDocumentPosition(host.querySelector('.msg--cont, .msg:last-child')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('D31 AC-2 expanded thinking never executes model-provided HTML', async () => {
  await render([{ id: 'unsafe', type: 'thinking', at: 1, text: '<script>window.leak()</script>\n<img src=x onerror="window.leak()">' }, answer]);
  await act(async () => host.querySelector<HTMLButtonElement>('.lom-thinking__head')!.click());
  const body = host.querySelector('.lom-thinking__body')!;
  expect(body.querySelector('script, img, iframe')).toBeNull();
  expect(body.textContent).toContain('<script>window.leak()</script>');
});

it.each([
  ['tool', 'queued'], ['tool', 'unconfirmed'], ['approval', 'unconfirmed'], ['question', 'unconfirmed'],
] as const)('D31 AC-4 %s %s cannot present an unfinished turn as complete', async (type, status) => {
  await render([answer, { id: 'pending', type, status, at: 3 }]);
  expect(host.querySelector('.msg--actions')).toBeNull();
});

it('D31 AC-4 unconfirmed send registration keeps actions hidden even with an idle UI', async () => {
  let settle!: (value: unknown) => void;
  const request = new Promise(resolve => { settle = resolve; });
  trackPendingSend('qoder', request, undefined, 'local-send');
  try {
    await render([answer]);
    expect(host.querySelector('.msg--actions')).toBeNull();
    await act(async () => { settle({ unknown: true }); await request; });
    await render([answer]);
    expect(host.querySelector('.msg--actions')).toBeNull();
    reconcileSendRegistrations('qoder', ['local-send']);
    await render([answer]);
    expect(host.querySelectorAll('.msg--actions')).toHaveLength(1);
  } finally {
    settle({ unknown: true }); await request;
    await Promise.resolve(); await Promise.resolve();
    reconcileSendRegistrations('qoder', ['local-send']);
  }
});

it('D31 AC-5 phone thinking and permission controls retain their existing behavior', async () => {
  await render([{ id: 'phone-thought', type: 'thinking', text: '手机思考', at: 1 }], 'phone');
  expect(host.querySelector('.lom-thinking')).toBeNull();
  expect(host.querySelector('.event__title')?.textContent).toContain('思考过程');
  await render([{ id: 'permission', type: 'approval', status: 'pending', command: '操作', at: 1 }], 'qoder');
  expect(host.querySelector('.event__title')?.textContent).toContain('需要你的确认');
  expect(host.querySelector('button[aria-label="复制"]')).toBeNull();
});
