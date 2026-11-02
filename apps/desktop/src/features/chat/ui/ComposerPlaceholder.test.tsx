import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ComposerPlaceholder } from './ComposerPlaceholder';
let host: HTMLDivElement, root: Root;
let reduced = false;
let change: (() => void) | undefined;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); reduced = false;
  vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener: (_: string, fn: () => void) => { change = fn; }, removeEventListener: () => { change = undefined; } }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const render = async (focused = false, phrases = ['你好', '任务']) => { await act(async () => root.render(<ComposerPlaceholder phrases={phrases} focused={focused} />)); };
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const text = () => host.querySelector('.composer__placeholder-text')?.textContent;
it('CW04 types, holds, erases and cycles without exposing animation to assistive technology', async () => {
  await render(); expect(text()).toBe('');
  await tick(299); expect(text()).toBe(''); await tick(1); expect(text()).toBe('你');
  await tick(48); expect(text()).toBe('你好'); await tick(1900); expect(text()).toBe('你好');
  await tick(200); expect(text()).toBe(''); await tick(448); expect(text()).toBe('任务');
  expect(host.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
});
it('CW04 focus hides only the decorative cursor and blur restores it', async () => {
  await render(); expect(host.querySelector('.composer__placeholder-caret')).not.toBeNull();
  await render(true); expect(host.querySelector('.composer__placeholder-caret')).toBeNull();
  await render(false); expect(host.querySelector('.composer__placeholder-caret')).not.toBeNull();
});
it('CW04 changing context discards the previous phrase and timer', async () => {
  await render(); await tick(348); await render(false, ['手机']); expect(text()).toBe('');
  await tick(348); expect(text()).toBe('手机');
});
it('CW04 reduced motion stays static, reacts to preference changes and cleans up timers', async () => {
  reduced = true; await render(); expect(text()).toBe('你好'); expect(host.querySelector('.composer__placeholder-caret')).toBeNull();
  await tick(5000); expect(text()).toBe('你好');
  reduced = false; await act(async () => change?.()); await tick(348); expect(text()).toBe('你好');
  reduced = true; await act(async () => change?.()); expect(text()).toBe('你好'); expect(vi.getTimerCount()).toBe(0);
});
