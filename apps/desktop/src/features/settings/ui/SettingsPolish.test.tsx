import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.hoisted(() => vi.stubEnv('VITE_LOM_CLOUD_URL', 'https://service.example.invalid'));
import { S } from '@/state/store';
import { shortcutRows, shortcutSummary } from '@/app/overlays/shortcuts';
import { Settings } from './Settings';

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const setUserAgent = (ua: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);

let host: HTMLDivElement, root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  S.cloud = 'signed-in';
  S.conn = 'ready';
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  S.points = null;
});

const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text);
const showPage = (page: string) => { S.settingsPage = page; act(() => root.render(<Settings />)); };

it('SET-POLISH-01 #431 macOS shows ⌘ and ⌥ in the shortcut summary and shortcut sheet', () => {
  setUserAgent(MAC_UA);
  expect(shortcutSummary()).toBe('⌘K 搜索 · ⌘N 新任务 · ⌘B 侧栏 · ⌘⌥B 工作区');
  expect(shortcutRows()[0][0]).toBe('⌘ K');
  expect(shortcutRows()[3][0]).toBe('⌘ ⌥ B');
});

it('SET-POLISH-01 #431 Windows shows Ctrl and Alt instead of ⌘ and ⌥, on the settings page too', () => {
  setUserAgent(WINDOWS_UA);
  expect(shortcutSummary()).toBe('Ctrl K 搜索 · Ctrl N 新任务 · Ctrl B 侧栏 · Ctrl Alt B 工作区');
  expect(shortcutRows().map(([k]) => k).join(' ')).not.toMatch(/[⌘⌥]/);
  expect(shortcutRows()[3][0]).toBe('Ctrl Alt B');
  showPage('general');
  expect(host.textContent).toContain('Ctrl K 搜索 · Ctrl N 新任务');
  expect(host.textContent).not.toContain('⌘');
});

it('SET-POLISH-01 #433 settings pages render font sizes only through design tokens', () => {
  setUserAgent(MAC_UA);
  S.account = { id: 'polish', name: '测试', email: 'polish@example.test' };
  S.points = { total: 100, free: 60, paid: 40, period: '2026-11', monthly_free: 300 };
  for (const page of ['account', 'models', 'data', 'about']) {
    showPage(page);
    const inline = [...host.querySelectorAll<HTMLElement>('[style*="font-size"]')].map(el => el.getAttribute('style') ?? '');
    for (const style of inline) expect(style, page).toMatch(/font-size:\s*var\(--fs-/);
  }
  showPage('about');
  expect([...host.querySelectorAll<HTMLElement>('[style*="font-size"]')].length).toBeGreaterThan(0);
});

it('SET-POLISH-01 #434 quota bar uses the server monthly cap and clamps between 0 and 100 percent', () => {
  setUserAgent(MAC_UA);
  S.points = { total: 180, free: 120, paid: 60, period: '2026-11', monthly_free: 300 };
  showPage('models');
  expect(host.querySelector<HTMLElement>('.progress__bar')!.style.width).toBe('60%');
  expect(host.textContent).not.toContain('每月赠送上限：未知');

  S.points = { total: 400, free: 350, paid: 50, period: '2026-11', monthly_free: 300 };
  act(() => root.render(<Settings />));
  expect(host.querySelector<HTMLElement>('.progress__bar')!.style.width).toBe('0%');

  S.points = { total: 300, free: 0, paid: 0, period: '2026-11', monthly_free: 300 };
  act(() => root.render(<Settings />));
  expect(host.querySelector<HTMLElement>('.progress__bar')!.style.width).toBe('100%');
});

it('SET-POLISH-01 #434 without a server monthly cap the page says unknown instead of inventing 300', () => {
  setUserAgent(MAC_UA);
  S.points = { total: 180, free: 120, paid: 60, period: '2026-11' };
  showPage('models');
  expect(host.querySelector('.progress')).toBeNull();
  expect(host.textContent).toContain('每月赠送上限：未知');
  expect(host.textContent).not.toContain('300');
});

it('SET-POLISH-01 #437 the data section is named for what it does and the cache button says preview cache', () => {
  setUserAgent(MAC_UA);
  showPage('data');
  expect(host.textContent).toContain('数据与缓存');
  expect(host.textContent).not.toContain('数据与备份');
  expect(button('清除预览缓存')).toBeDefined();
  expect(button('清除')).toBeUndefined();
});
