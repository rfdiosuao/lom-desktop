import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WindowControls } from './WindowControls';

const h = vi.hoisted(() => ({
  win: {
    isMaximized: vi.fn(async () => false),
    onResized: vi.fn(async () => () => {}),
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {}),
    startResizeDragging: vi.fn(async () => {}),
  },
  invoke: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => h.win }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: h.invoke }));

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  h.win.isMaximized.mockResolvedValue(false);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const click = async (label: string) => {
  await act(async () => button(label)?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};

it('window buttons minimize, toggle maximize and close the shell window', async () => {
  await act(async () => root.render(<WindowControls />));
  await click('最小化');
  await click('最大化');
  await click('关闭');
  expect(h.win.minimize).toHaveBeenCalledOnce();
  expect(h.win.toggleMaximize).toHaveBeenCalledOnce();
  expect(h.invoke).toHaveBeenCalledWith('close_main_window');
});

it('a maximized window offers restore and drops the resize edges', async () => {
  h.win.isMaximized.mockResolvedValue(true);
  await act(async () => root.render(<WindowControls />));
  expect(button('向下还原')).not.toBeNull();
  expect(button('最大化')).toBeNull();
  expect(host.querySelector('.window-resizers__edge')).toBeNull();
});

it('window edges start a native resize drag for their direction', async () => {
  await act(async () => root.render(<WindowControls />));
  const edge = host.querySelector('.window-resizers__edge--east');
  await act(async () => edge?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  expect(h.win.startResizeDragging).toHaveBeenCalledWith('East');
});
