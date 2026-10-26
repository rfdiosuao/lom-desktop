import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ActivityControls, defaultActivityControls } from './ActivityControls';
import type { ActivityControlsState } from './ActivityControls';

/* D33-AC-4：工具栏的排序、内容、成员和两个开关把状态交给上层。 */

let host: HTMLDivElement, root: Root;
const members = [{ slotId: 'lead', name: 'Lom' }, { slotId: 'w1', name: 'CodeBuddy' }];

const render = async (value: ActivityControlsState, onChange: (next: ActivityControlsState) => void) => {
  await act(async () => { root.render(<ActivityControls value={value} onChange={onChange} members={members} />); });
};

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); });

it('切换排序和内容筛选', async () => {
  const changes: ActivityControlsState[] = [];
  await render(defaultActivityControls, (next) => changes.push(next));
  const radios = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  expect(radios).toHaveLength(5);
  await act(async () => { radios[1].click(); radios[4].click(); });
  expect(changes[0].direction).toBe('asc');
  expect(changes.at(-1)?.kind).toBe('task');
});

it('成员筛选可多选，并标出已选项', async () => {
  const changes: ActivityControlsState[] = [];
  await render({ ...defaultActivityControls, members: ['lead'] }, (next) => changes.push(next));
  const chips = [...host.querySelectorAll<HTMLButtonElement>('.act-bar__chip')];
  expect(chips[0].getAttribute('aria-pressed')).toBe('false'); // 全部成员：已选了具体成员
  expect(chips[1].getAttribute('aria-pressed')).toBe('true');

  await act(async () => { chips[2].click(); });
  expect(changes.at(-1)?.members).toEqual(['lead', 'w1']);

  await act(async () => { chips[0].click(); });
  expect(changes.at(-1)?.members).toEqual([]);
});

it('系统消息和已完成任务开关默认关闭，点击后打开', async () => {
  const changes: ActivityControlsState[] = [];
  await render(defaultActivityControls, (next) => changes.push(next));
  const switches = [...host.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
  expect(switches.map((s) => s.getAttribute('aria-checked'))).toEqual(['false', 'false']);
  await act(async () => { switches[0].click(); });
  expect(changes.at(-1)?.showSystem).toBe(true);
  await act(async () => { switches[1].click(); });
  expect(changes.at(-1)?.showFinished).toBe(true);
});
