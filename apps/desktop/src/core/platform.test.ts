import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ tauri: false }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => h.tauri }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

import { applyShellClasses } from './platform';

const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
const setUserAgent = (ua: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);

let root: HTMLElement;
beforeEach(() => { root = document.createElement('html'); });
afterEach(() => { vi.restoreAllMocks(); h.tauri = false; });

it('WIN-TITLEBAR-02 a Windows shell is marked so the self-drawn window buttons take over the top', () => {
  h.tauri = true;
  setUserAgent(WINDOWS_UA);
  applyShellClasses(root);
  expect(root.classList.contains('is-windows')).toBe(true);
  expect(root.classList.contains('in-shell')).toBe(true);
});

it('WIN-TITLEBAR-02 a macOS shell keeps the existing top layout', () => {
  h.tauri = true;
  setUserAgent(MAC_UA);
  applyShellClasses(root);
  expect(root.classList.contains('is-windows')).toBe(false);
  expect(root.classList.contains('in-shell')).toBe(true);
});

it('WIN-TITLEBAR-02 a browser on Windows is not a shell and gets no Windows layout', () => {
  setUserAgent(WINDOWS_UA);
  applyShellClasses(root);
  expect(root.classList.contains('is-windows')).toBe(false);
  expect(root.classList.contains('in-shell')).toBe(false);
});
