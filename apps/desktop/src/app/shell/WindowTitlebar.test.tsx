import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import { initialState } from '@/state/state';
import { Shell } from './Shell';

const h = vi.hoisted(() => ({
  win: { startDragging: vi.fn(async () => {}), toggleMaximize: vi.fn(async () => {}) },
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => h.win }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => {}), isTauri: () => true }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* 样式表只是用来在 jsdom 里算出浏览器会得到的最终样式（断言的是计算结果，不是样式文本）。 */
const fs = await vi.importActual<{ readFileSync(path: string, encoding: 'utf8'): string }>('node:fs');
const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const sheet = (name: string) => fs.readFileSync(`${cwd}/src/shared/styles/${name}`, 'utf8');
const tokensCss = sheet('tokens.css'), layoutCss = sheet('layout.css');

/** jsdom 不解析 var()：把设计令牌代入样式表，让它能像浏览器一样算出最终的内边距。 */
const tokenValue = (name: string): string => {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(tokensCss);
  return m ? m[1].trim().replace(/var\((--[\w-]+)\)/g, (_, n: string) => tokenValue(n)) : '';
};
const resolved = (css: string) => css.replace(/var\((--[\w-]+)\)/g, (all, n: string) => tokenValue(n) || all);

/** 按花括号层级拆出顶层规则；注释先去掉。 */
function topLevelRules(css: string): string[] {
  const out: string[] = []; let depth = 0, start = 0;
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) { out.push(text.slice(start, i + 1).trim()); start = i + 1; }
  }
  return out;
}

let host: HTMLDivElement, root: Root, style: HTMLStyleElement;
beforeEach(async () => {
  vi.clearAllMocks();
  Object.assign(S, initialState()); S.route = { name: 'home' }; S.mode = 'desktop';
  style = document.createElement('style');
  document.head.append(style);
  for (const rule of topLevelRules(resolved(layoutCss))) {
    try { style.sheet!.insertRule(rule, style.sheet!.cssRules.length); } catch { /* jsdom 不认的规则（容器查询等）与本测试无关 */ }
  }
  document.documentElement.classList.add('in-shell', 'is-windows');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Shell />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); style.remove();
  document.documentElement.classList.remove('in-shell', 'is-windows');
});

const press = async (el: Element | null, detail = 1) => {
  await act(async () => el?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail })));
};
const q = (selector: string) => host.querySelector<HTMLElement>(selector);
const padRight = (selector: string) => getComputedStyle(q(selector)!).paddingRight.replace(/\s+/g, '');
/* 三个窗口按钮宽 + 6px；jsdom 把 calc() 化简后原样返回 */
const AVOID = `calc(${Number(tokenValue('--titlebar-btn-w').replace('px', '')) * 3 + 6}px)`;

it('WIN-TITLEBAR-02 the shell has no full-width blank title row above the sidebar and workbench', () => {
  expect(host.querySelector('.window-titlebar')).toBeNull();
  const sidebar = q('.sidebar')!;
  expect(sidebar.firstElementChild?.className).toBe('sidebar__top');
  expect(sidebar.children[1].className).toBe('brand');
});

it('WIN-TITLEBAR-02 dragging the logo row moves the window and double-clicking it toggles maximize', async () => {
  await press(q('.sidebar .brand'));
  expect(h.win.startDragging).toHaveBeenCalledOnce();
  await press(q('.sidebar .brand'), 2);
  expect(h.win.toggleMaximize).toHaveBeenCalledOnce();
});

it('WIN-TITLEBAR-02 dragging the top bar moves the window and double-clicking it toggles maximize', async () => {
  await press(q('.center__header'));
  expect(h.win.startDragging).toHaveBeenCalledOnce();
  await press(q('.center__header'), 2);
  expect(h.win.toggleMaximize).toHaveBeenCalledOnce();
});

it('WIN-TITLEBAR-02 the search and collapse buttons beside the logo never start a window drag', async () => {
  await press(q('.sidebar__top button[aria-label^="搜索"]'));
  await press(q('.sidebar__top button[aria-label^="收起侧栏"]'));
  expect(h.win.startDragging).not.toHaveBeenCalled();
});

it('WIN-TITLEBAR-02 with the workspace open the workspace header makes room for the window buttons', () => {
  expect(q('.shell.is-right-collapsed')).toBeNull();
  expect(padRight('.workspace__head')).toBe(AVOID);
  expect(padRight('.center__header')).not.toBe(AVOID);
});

it('WIN-TITLEBAR-02 with the workspace collapsed the top bar makes room for the window buttons', async () => {
  await act(async () => update(s => { s.layout.rightCollapsed = true; }));
  expect(q('.shell.is-right-collapsed')).not.toBeNull();
  expect(padRight('.center__header')).toBe(AVOID);
});

it('WIN-TITLEBAR-02 on the settings page the top bar makes room for the window buttons', async () => {
  await act(async () => update(s => { s.route = { name: 'settings' } as typeof s.route; }));
  expect(q('.shell.no-right')).not.toBeNull();
  expect(padRight('.center__header')).toBe(AVOID);
});

it('WIN-TITLEBAR-02 with the sidebar collapsed the top bar keeps its room and drops the traffic-light placeholder', async () => {
  await act(async () => update(s => { s.layout.leftCollapsed = true; s.layout.rightCollapsed = true; }));
  expect(padRight('.center__header')).toBe(AVOID);
  expect(getComputedStyle(q('.collapsed-bar .traffic')!).display).toBe('none');
  expect(getComputedStyle(q('.sidebar .traffic')!).display).toBe('none');
});

it('WIN-TITLEBAR-02 outside Windows nothing is reserved for window buttons and the traffic-light placeholder stays', async () => {
  document.documentElement.classList.remove('is-windows');
  await act(async () => update(s => { s.layout.rightCollapsed = true; }));
  expect(padRight('.center__header')).not.toBe(AVOID);
  expect(getComputedStyle(q('.sidebar .traffic')!).display).not.toBe('none');
});

it('WIN-TITLEBAR-03 the workbench sits a small even gap below the top edge and stays flush right', () => {
  const bench = getComputedStyle(q('.shell__workbench')!);
  expect(bench.marginTop).toBe(bench.marginBottom);
  expect(bench.marginTop).not.toBe('0px');
  expect(bench.marginRight).toBe('0px');
  expect(getComputedStyle(q('.resizer--right')!).top).toBe(bench.marginTop);
});
