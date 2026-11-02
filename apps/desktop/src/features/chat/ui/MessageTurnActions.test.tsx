import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Msg } from '@/state/types';

const m = vi.hoisted(() => ({ regenerate: vi.fn() }));
vi.mock('../actions/composer', () => ({ regenerate: m.regenerate, approve: vi.fn() }));

import { MessageList } from './MessageList';

let host: HTMLDivElement, root: Root;
const render = async (msgs: Msg[]) => { await act(async () => root.render(<MessageList msgs={msgs} ctxId="conv:lead" />)); return host; };
const count = (label: string) => host.querySelectorAll(`button[aria-label="${label}"]`).length;
const user = (id: string, text: string): Msg => ({ id, type: 'user', at: 1, text });
const assistant = (id: string, text: string, extra: Partial<Msg> = {}): Msg => ({ id, type: 'assistant', at: 1, text, ...extra });
const tool = (id: string, extra: Partial<Msg> = {}): Msg => ({ id, type: 'tool', at: 1, status: 'done', ...extra });

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  S.eventOpen = {}; S.running = {}; S.toast = null;
  S.convs = [{ id: 'lead', owner: 'pc', title: 'Leader', updated: 1, messages: [], remote: true }];
  m.regenerate.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const withClipboard = async (run: (writeText: ReturnType<typeof vi.fn>) => Promise<void>) => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  try { await run(writeText); }
  finally {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
};

it('D30 AC-1 keeps one copy and one regenerate at the end of a tool-split reply', async () => {
  await withClipboard(async writeText => {
    await render([
      user('u', '写脚本'),
      assistant('a1', '先看结构。'),
      { id: 'think', type: 'thinking', at: 2, text: '内部思考' },
      tool('t1', { tool: '运行命令', detail: 'ls', output: '工具输出' }),
      assistant('a2', '目录干净了。'),
      tool('t2', { tool: '写文件', detail: 'config.sh' }),
      assistant('a3', '继续写核心脚本。\n[LOM_GOAL_DONE:42]'),
    ]);
    expect(count('复制')).toBe(1);
    expect(count('重新生成')).toBe(1);
    const actions = host.querySelector('.msg--actions')!;
    const lastTool = host.querySelectorAll('.tools')[1];
    expect(lastTool.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="复制"]')!.click());
    expect(writeText).toHaveBeenCalledWith('先看结构。\n\n目录干净了。\n\n继续写核心脚本。');
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="重新生成"]')!.click());
    expect(m.regenerate).toHaveBeenCalledWith('conv:lead', expect.objectContaining({ id: 'a3' }));
  });
});

it('D30 AC-2 shows actions only after streaming, tools and pending prompts finish', async () => {
  await render([
    user('u', '做'),
    assistant('a', '处理中', { streaming: true }),
    tool('t', { status: 'running' }),
  ]);
  expect(count('复制')).toBe(0); expect(count('重新生成')).toBe(0);
  const done = [user('u', '做'), assistant('a', '完成'), tool('t', { status: 'done' })];
  await render(done);
  expect(count('复制')).toBe(1); expect(count('重新生成')).toBe(1);
  S.running = { lead: true };
  await render(done);
  expect(count('复制')).toBe(0); expect(count('重新生成')).toBe(0);
  S.running = {};
  await render(done);
  expect(count('复制')).toBe(1); expect(count('重新生成')).toBe(1);
});

it.each([
  ['approval', 'pending'],
  ['approval', 'submitting'],
  ['question', 'pending'],
  ['question', 'submitting'],
] as const)('D30 AC-2 hides reply actions while a %s is %s', async (type, status) => {
  await render([user('u', '做'), assistant('a', '等你确认'), { id: 'p', type, at: 2, status }]);
  expect(count('复制')).toBe(0); expect(count('重新生成')).toBe(0);
  await render([user('u', '做'), assistant('a', '等你确认'), { id: 'p', type, at: 2, status: type === 'approval' ? 'approved' : 'resolved' }]);
  expect(count('复制')).toBe(1); expect(count('重新生成')).toBe(1);
});

it('D30 a missing clipboard reports a failure instead of doing nothing', async () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Reflect.deleteProperty(navigator, 'clipboard');
  try {
    await render([user('u', '问'), assistant('a', '答')]);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="复制"]')!.click();
      await Promise.resolve();
    });
    expect(S.toast?.text).toContain('复制失败');
    expect(S.toast?.text).toContain('剪贴板不可用');
  } finally {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
  }
});

it('D30 a rejected clipboard write reports the failure', async () => {
  await withClipboard(async writeText => {
    writeText.mockRejectedValueOnce(new Error('写入被拒绝'));
    await render([user('u', '问'), assistant('a', '答')]);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="复制"]')!.click();
      await Promise.resolve();
    });
    expect(S.toast?.text).toContain('复制失败');
    expect(S.toast?.text).toContain('写入被拒绝');
  });
});

it('D30 AC-3 keeps each user turn independent', async () => {
  await withClipboard(async writeText => {
    await render([user('u1', '第一问'), assistant('a1', '第一答'), user('u2', '第二问'), assistant('a2', '第二答')]);
    const copies = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label="复制"]')];
    expect(copies).toHaveLength(2);
    await act(async () => copies[0].click());
    expect(writeText).toHaveBeenLastCalledWith('第一答');
    await act(async () => copies[1].click());
    expect(writeText).toHaveBeenLastCalledWith('第二答');
    const regen = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label="重新生成"]')];
    await act(async () => regen[1].click());
    expect(m.regenerate).toHaveBeenLastCalledWith('conv:lead', expect.objectContaining({ id: 'a2' }));
  });
});

it('D30 AC-4 leaves a tool-only turn without reply actions', async () => {
  await render([user('u', '做'), tool('t', { tool: '运行命令', detail: 'ls' })]);
  expect(count('复制')).toBe(0); expect(count('重新生成')).toBe(0);
});
