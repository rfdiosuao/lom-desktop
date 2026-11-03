import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssistantTabs } from './AssistantTabs';

let host: HTMLDivElement, root: Root;
const items = [{ id: 'a', name: '小麓', directory: '/a', workspace: '/a' }, { id: 'b', name: '负责季度报告与客户回访的工作助理', directory: '/b', workspace: '/b' }];
const scrolled: Element[] = [];
const render = (selected: string) => act(async () => root.render(<AssistantTabs items={items} selected={selected} onSelect={() => {}} onDelete={() => {}} running={() => false} />));
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  scrolled.length = 0;
  // jsdom 不实现 scrollIntoView，这里记录被滚到可见处的元素
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete (Element.prototype as Partial<Element>).scrollIntoView; });

it('UI-AUDIT-03 行为 6 选中的助理标签滚到可见处并带完整名称提示，普通滚轮横向滚动标签条', async () => {
  await render('a');
  await render('b');
  expect(scrolled.at(-1)?.textContent).toBe(items[1].name);
  expect(host.querySelector('.is-active')?.getAttribute('title')).toBe(items[1].name);
  const strip = host.querySelector<HTMLDivElement>('.pa-assistants')!;
  await act(async () => { strip.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true })); });
  expect(strip.scrollLeft).toBe(40);
});

it('PA-TAB-01 AC-2 标签上的 × 叫「删除助理」，运行中的助理不可删除并说明原因', async () => {
  const onDelete = vi.fn();
  await act(async () => root.render(<AssistantTabs items={items} selected="a" onSelect={() => {}} onDelete={onDelete} running={item => item.id === 'b'} />));
  const [a, b] = [...host.querySelectorAll<HTMLButtonElement>('[aria-label^="删除助理："]')];
  expect(a.getAttribute('aria-label')).toBe('删除助理：小麓');
  expect(b.disabled).toBe(true); expect(b.title).toBe(`${items[1].name}正在执行任务，结束后才能删除`);
  await act(async () => a.click());
  expect(onDelete).toHaveBeenCalledWith(items[0]);
});
