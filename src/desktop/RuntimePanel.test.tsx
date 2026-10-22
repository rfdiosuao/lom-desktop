import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RuntimePanel } from './RuntimePanel';
import type { CoreStatus } from '../runtime/types';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), native: vi.fn(() => true) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: mocks.native }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
let host: HTMLDivElement, root: Root;
const status = (state: string): CoreStatus => ({ state, attempt: 0, lastError: null, endpoint: null, logDir: null });
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  mocks.invoke.mockReset(); mocks.listen.mockReset(); mocks.native.mockReturnValue(true);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('loads the native status even when startup events preceded mounting', async () => {
  mocks.listen.mockResolvedValue(vi.fn()); mocks.invoke.mockResolvedValue(status('unavailable'));
  await act(async () => root.render(<RuntimePanel />));
  expect(mocks.invoke).toHaveBeenCalledWith('core_status');
  expect(host.querySelector('[role="status"]')?.textContent).toContain('unavailable');
});
it('a status event wins over an older pending snapshot', async () => {
  let finish!: (value: CoreStatus) => void;
  let event!: (value: { payload: CoreStatus }) => void;
  mocks.listen.mockImplementation(async (_name, callback) => { event = callback; return vi.fn(); });
  mocks.invoke.mockImplementation(() => new Promise<CoreStatus>(resolve => { finish = resolve; }));
  await act(async () => root.render(<RuntimePanel />));
  await act(async () => event({ payload: status('ready') }));
  await act(async () => finish(status('starting')));
  expect(host.querySelector('[role="status"]')?.textContent).toContain('ready');
});
it('unsubscribes even when native registration resolves after unmount', async () => {
  let finish!: (stop: () => void) => void;
  const stop = vi.fn();
  mocks.listen.mockImplementation(() => new Promise<() => void>(resolve => { finish = resolve; }));
  await act(async () => root.render(<RuntimePanel />));
  await act(async () => root.render(null));
  await act(async () => finish(stop));
  expect(stop).toHaveBeenCalledOnce(); expect(mocks.invoke).not.toHaveBeenCalled();
});
