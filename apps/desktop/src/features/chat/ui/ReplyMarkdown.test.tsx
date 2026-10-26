import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { S } from '@/state/store';
import type { Msg } from '@/state/types';
import { MessageList } from './MessageList';

let host: HTMLDivElement, root: Root;
const render = async (msgs: Msg[], id: string) => {
  await act(async () => root.render(<MessageList msgs={msgs} ctxId={`conv:${id}`} />));
};
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  S.running = {}; S.eventOpen = {};
  S.convs = [
    { id: 'lom', owner: 'pc', title: '任务', updated: 1, messages: [], remote: true },
    { id: 'qoder', owner: 'pc', agentId: 'qoder', agentName: 'Qoder', title: '任务', updated: 1, messages: [], remote: true },
    { id: 'phone', owner: 'dev_test', phoneSession: 'session', title: '手机', updated: 1, messages: [] },
  ];
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

/** 同一份含标题、列表、表格、引用、围栏的样例（议题 #82 的关闭条件） */
const SAMPLE = [
  '## 结论', '先看现状：', '- 标题要认', '- 列表要认', '', '> 注意：别改旧数据', '',
  '| 项 | 状态 |', '| :-- | --: |', '| **标题** | 完成 |', '', '步骤：', '1. 安装', '2. 运行', '', '```ts', 'const ok = true;', '```', '', '见 [文档](https://example.com/doc)',
].join('\n');

const bodyOf = () => host.querySelector('.msg__text:not(.lom-thinking__body)')!;

it('CW06 the same sample renders identically for the built-in Lom and an external Agent', async () => {
  const reply: Msg = { id: 'a', type: 'assistant', text: SAMPLE, at: 2 };
  await render([reply], 'lom');
  const lom = bodyOf().innerHTML;
  await render([reply], 'qoder');
  const external = bodyOf().innerHTML;
  expect(external).toBe(lom);
  const body = bodyOf();
  expect(body.querySelector('h4')?.textContent).toBe('结论');
  expect([...body.querySelectorAll('ul > li')].map(li => li.textContent)).toEqual(['标题要认', '列表要认']);
  expect(body.querySelector('blockquote')?.textContent).toBe('注意：别改旧数据');
  expect(body.querySelectorAll('table th')).toHaveLength(2);
  expect(body.querySelector('table td b')?.textContent).toBe('标题');
  expect([...body.querySelectorAll('ol > li')].map(li => li.textContent)).toEqual(['安装', '运行']);
  expect(body.querySelector('pre code')?.textContent).toBe('const ok = true;');
  expect(body.querySelector('a.md-link')?.getAttribute('href')).toBe('https://example.com/doc');
  // 没有任何源码符号漏成正文
  expect(body.textContent).not.toMatch(/##|```|\*\*|\| :--|^> /m);
});

it('CW06 a code block split by a tool call renders as code before and after the tool', async () => {
  const msgs: Msg[] = [
    { id: 'a1', type: 'assistant', text: '先写入文件：\n```ts\nconst a = 1;', at: 1 },
    { id: 't', type: 'tool', tool: '写文件', command: 'write', at: 2, status: 'done' },
    { id: 'a2', type: 'assistant', text: 'const b = 2;\n```\n写好了，列表：\n- 一\n- 二', at: 3 },
  ];
  for (const id of ['lom', 'qoder']) {
    await render(msgs, id);
    const bodies = [...host.querySelectorAll('.msg__text')];
    expect(bodies, id).toHaveLength(2);
    expect(bodies[0].querySelector('pre code')?.textContent, id).toBe('const a = 1;');
    expect(bodies[0].textContent, id).not.toContain('```');
    expect(bodies[1].querySelector('pre code')?.textContent, id).toBe('const b = 2;');
    expect(bodies[1].textContent, id).not.toContain('```');
    expect([...bodies[1].querySelectorAll('li')].map(li => li.textContent), id).toEqual(['一', '二']);
  }
});

it('CW06 an unclosed fence in the last segment of a finished turn stays as text instead of swallowing the rest', async () => {
  await render([{ id: 'a', type: 'assistant', text: '说明\n```ts\n没有闭合', at: 1 }], 'lom');
  expect(host.querySelector('pre')).toBeNull();
  expect(bodyOf().textContent).toContain('没有闭合');
});

it('CW06 a numbered list continued after a tool call keeps its numbers', async () => {
  const msgs: Msg[] = [
    { id: 'a1', type: 'assistant', text: '1. 先装依赖\n2. 再写代码', at: 1 },
    { id: 't', type: 'tool', tool: '运行命令', command: 'npm i', at: 2, status: 'done' },
    { id: 'a2', type: 'assistant', text: '3. 最后跑测试\n4. 提交', at: 3 },
  ];
  await render(msgs, 'qoder');
  const lists = [...host.querySelectorAll('ol')];
  expect(lists).toHaveLength(2);
  expect(lists[1].getAttribute('start')).toBe('3');
  expect([...lists[1].querySelectorAll('li')].map(li => li.textContent)).toEqual(['最后跑测试', '提交']);
});

const THOUGHT = '**先看**\n- 读配置\n- 查日志\n\n再改：\n1. 改一\n2. 改二';

it('CW06 thinking keeps its line breaks, lists and bold the same way in the compact Lom view and the phone view', async () => {
  const thought: Msg = { id: 'th', type: 'thinking', text: THOUGHT, at: 1 };
  await render([thought], 'lom');
  await act(async () => host.querySelector<HTMLButtonElement>('.lom-thinking__head')!.click());
  const compact = host.querySelector('.lom-thinking__body')!;
  S.eventOpen = {};
  await render([thought], 'phone');
  await act(async () => host.querySelector<HTMLButtonElement>('.event__head')!.click());
  const phone = host.querySelector('.event__body .msg__text')!;
  for (const body of [compact, phone]) {
    expect(body.querySelector('b')?.textContent).toBe('先看');
    expect([...body.querySelectorAll('ul > li')].map(li => li.textContent)).toEqual(['读配置', '查日志']);
    expect([...body.querySelectorAll('ol > li')].map(li => li.textContent)).toEqual(['改一', '改二']);
  }
  expect(phone.innerHTML).toBe(compact.innerHTML);
});

it('CW06 thinking is collapsed by default and toggles the same way in both views', async () => {
  const thought: Msg = { id: 'th2', type: 'thinking', text: '想一想', at: 1 };
  await render([thought], 'qoder');
  expect(host.querySelector('.lom-thinking__body')).toBeNull();
  await render([thought], 'phone');
  expect(host.querySelector('.event__body')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('.event__head')!.click());
  expect(host.querySelector('.event__body')?.textContent).toBe('想一想');
  await act(async () => host.querySelector<HTMLButtonElement>('.event__head')!.click());
  expect(host.querySelector('.event__body')).toBeNull();
});
