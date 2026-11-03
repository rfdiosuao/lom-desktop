import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStickBottom } from './Chat';

/* UI-AUDIT-05 F-13：不经过重新渲染的变高（图片加载、展开测量）也要保持贴底 */

class FakeResizeObserver {
  static current: FakeResizeObserver | undefined;
  readonly targets = new Set<Element>();
  constructor(private readonly callback: () => void) { FakeResizeObserver.current = this; }
  observe(target: Element) { this.targets.add(target); }
  unobserve(target: Element) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
  /** 模拟浏览器报告某个元素尺寸变化：只有被观察的元素才会触发回调 */
  resize(target: Element) { if (this.targets.has(target)) this.callback(); }
}

function Probe({ items }: { items: string[] }) {
  const stick = useStickBottom<HTMLDivElement>();
  return <div className="probe" ref={stick.ref} onScroll={stick.onScroll}>{items.map(item => <p key={item}>{item}</p>)}</div>;
}

let host: HTMLDivElement, root: Root;
const box = { height: 1000, top: 0 };
const render = (items: string[]) => act(async () => root.render(<Probe items={items} />));
const scroller = () => host.querySelector<HTMLDivElement>('.probe')!;
/** jsdom 没有布局：给滚动区装上可控的内容高度、可视高度和滚动位置 */
const fakeLayout = (el: HTMLElement) => {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => box.height });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 300 });
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => box.top, set: (v: number) => { box.top = Math.min(v, box.height - 300); } });
};
const userScrollsTo = (top: number) => act(async () => { box.top = top; scroller().dispatchEvent(new Event('scroll')); });

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  FakeResizeObserver.current = undefined;
  box.height = 1000; box.top = 0;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('UI-AUDIT-05 F-13 content that grows without a re-render is pinned while the reader is at the bottom', async () => {
  await render(['a', 'b']);
  fakeLayout(scroller());
  const image = scroller().lastElementChild!;
  box.height = 1400;
  FakeResizeObserver.current!.resize(image);
  expect(box.top).toBe(1100);
});

it('UI-AUDIT-05 F-13 growth does not pull the reader down after they scrolled up, and resumes at the bottom', async () => {
  await render(['a', 'b']);
  fakeLayout(scroller());
  await userScrollsTo(200);
  box.height = 1600;
  FakeResizeObserver.current!.resize(scroller().firstElementChild!);
  expect(box.top).toBe(200);
  await userScrollsTo(1300);
  box.height = 2000;
  FakeResizeObserver.current!.resize(scroller().firstElementChild!);
  expect(box.top).toBe(1700);
});

it('UI-AUDIT-05 F-13 newly rendered children are watched, removed ones are released', async () => {
  await render(['a']);
  fakeLayout(scroller());
  const first = scroller().firstElementChild!;
  await render(['b']);
  const next = scroller().firstElementChild!;
  box.height = 1500;
  FakeResizeObserver.current!.resize(next);
  expect(box.top).toBe(1200);
  box.height = 1800;
  FakeResizeObserver.current!.resize(first);
  expect(box.top).toBe(1200);
});

it('UI-AUDIT-05 F-13 works without ResizeObserver', async () => {
  vi.stubGlobal('ResizeObserver', undefined);
  await render(['a']);
  fakeLayout(scroller());
  box.height = 1500;
  await render(['a', 'b']);
  expect(box.top).toBe(1200);
});
