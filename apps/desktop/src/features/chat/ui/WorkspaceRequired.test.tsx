import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ api: vi.fn(), pick: vi.fn(), start: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => ({ url: 'http://core', token: 't', defaultFolder: '/Users/me/Documents', homeDir: '/Users/me' }) }));
vi.mock('@/core/platform', async orig => ({ ...(await orig<object>()), pickFolder: m.pick }));
vi.mock('../runtime/tasks', async orig => ({ ...(await orig<object>()), startDesktopTask: m.start }));
import { S } from '@/state/store';
import { initialState } from '@/state/state';
import { Composer } from './Composer';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); localStorage.clear(); Object.assign(S, initialState());
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  S.mode = 'desktop'; S.route = { name: 'home' }; S.activeConv = ''; S.homeDir = '/Users/me'; S.folder = '';
  S.drafts = { home: '写一个网页' };
  m.start.mockResolvedValue('new1'); m.api.mockResolvedValue({});
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const sendBtn = () => host.querySelector<HTMLButtonElement>('button[aria-label="发送"]')!;
const chip = () => host.querySelector('.ws-bar');
const render = (ckey = 'home') => act(async () => root.render(<Composer ckey={ckey} />));

it('WS-REQUIRED-01 AC1 without a workspace the home composer shows a prominent picker and a blocked send button', async () => {
  await render();
  expect(chip()?.textContent).toContain('选择工作区');
  expect(chip()?.classList.contains('is-missing')).toBe(true);
  expect(sendBtn().getAttribute('aria-disabled')).toBe('true');
});

it('WS-REQUIRED-01 AC1 clicking send without a workspace opens the system folder picker and creates no task', async () => {
  m.pick.mockResolvedValue(null);
  await render();
  await act(async () => sendBtn().click());
  expect(m.pick).toHaveBeenCalledTimes(1);
  expect(m.start).not.toHaveBeenCalled();
  expect(S.folder).toBe('');
  expect(S.drafts.home).toBe('写一个网页');
});

it('WS-REQUIRED-01 AC1 picking a folder from the send click remembers it and then starts the task', async () => {
  m.pick.mockResolvedValue('/Users/me/proj');
  await render();
  await act(async () => sendBtn().click());
  expect(S.folder).toBe('/Users/me/proj');
  expect(S.recentFolders[0]).toBe('/Users/me/proj');
  expect(m.start).toHaveBeenCalledTimes(1);
});

it('WS-REQUIRED-01 AC3 the remembered recent workspace is the default and its path is shown, not hidden', async () => {
  S.folder = '/Users/me/proj'; S.recentFolders = ['/Users/me/proj'];
  await render();
  expect(chip()?.textContent).toContain('~/proj');
  expect(chip()?.classList.contains('is-missing')).toBe(false);
  expect(sendBtn().getAttribute('aria-disabled')).toBeNull();
  await act(async () => sendBtn().click());
  expect(m.pick).not.toHaveBeenCalled();
  expect(m.start).toHaveBeenCalledTimes(1);
});

it('WS-REQUIRED-01 AC2 an open task shows its own workspace in the composer', async () => {
  S.convs = [{ id: 'k1', owner: 'pc', title: 't', updated: 1, messages: [], remote: true, loaded: true, workspace: '/Users/me/other' }];
  await render('conv:k1');
  expect(chip()?.textContent).toContain('~/other');
});

it('WS-REQUIRED-01 AC6 an old task without a recorded workspace stays usable and asks to pick one', async () => {
  S.convs = [{ id: 'old', owner: 'pc', title: '旧', updated: 1, messages: [], remote: true, loaded: true }];
  S.drafts = { 'conv:old': '继续' };
  await render('conv:old');
  expect(chip()?.textContent).toContain('补选');
  expect(sendBtn().getAttribute('aria-disabled')).toBeNull();
  await act(async () => sendBtn().click());
  expect(m.pick).not.toHaveBeenCalled();
});

it('WS-REQUIRED-01 AC1 phone mode needs no workspace', async () => {
  S.mode = 'phone';
  await render();
  expect(chip()).toBeNull();
});
