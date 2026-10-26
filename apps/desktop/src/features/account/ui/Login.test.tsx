vi.mock('@/features/account/runtime/serviceConfig', () => ({ cloudConfigured: () => true, LOM_CLOUD_URL: 'https://service.example.invalid', requireCloudService: () => {}, CLOUD_UNAVAILABLE: '后端未包含' }));
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
const { signIn, restoreSession } = vi.hoisted(() => ({ signIn: vi.fn(), restoreSession: vi.fn() }));
vi.mock('../runtime/cloud', () => ({ signIn, restoreSession }));
vi.mock('@/app/bootstrap', () => ({ startCore: vi.fn() }));
vi.mock('@/app/shell/Shell', () => ({ Shell: () => <div data-workspace>工作台</div> }));
vi.mock('@/app/shell/layout', () => ({ applyTheme: vi.fn() }));
vi.mock('@/app/overlays/ModalHost', () => ({ ModalHost: () => null }));
vi.mock('@/app/overlays/MenuHost', () => ({ MenuHost: () => null }));
import { App } from '@/app/App';
let host: HTMLDivElement; let root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  signIn.mockReset();
  vi.stubGlobal('matchMedia', () => ({ addEventListener() {}, removeEventListener() {} }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(<App />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const click = (text: string) => act(() => { [...host.querySelectorAll('button')].find(b => b.textContent === text)!.click(); });
it('S04-01 AC-6/8 验证前不挂载工作台、成功才进入、退出移除工作台', () => {
  expect(host.querySelector('[data-workspace]')).toBeNull();
  expect(host.textContent).toContain('正在恢复登录');
  act(() => update(s => { s.cloud = 'signed-in'; }));
  expect(host.querySelector('[data-workspace]')).not.toBeNull();
  act(() => update(s => { s.cloud = 'signed-out'; }));
  expect(host.querySelector('[data-workspace]')).toBeNull();
  expect(host.textContent).toContain('欢迎来到 Lom');
});
it('S04-01 AC-7 登录注册及两个社交按钮使用正确入口', () => {
  act(() => update(s => { s.cloud = 'signed-out'; }));
  click('使用 HEANG 账号登录'); expect(signIn).toHaveBeenLastCalledWith('login');
  click('注册'); click('注册 HEANG 账号'); expect(signIn).toHaveBeenLastCalledWith('register');
  click('G使用 Google 继续'); expect(signIn).toHaveBeenLastCalledWith('google');
  click('使用 GitHub 继续'); expect(signIn).toHaveBeenLastCalledWith('github');
});
it('S04-01 AC-6 登录前快捷键不能打开菜单或工作台，失败提供重试', () => {
  act(() => update(s => { s.cloud = 'unavailable'; s.cloudError = '离线'; }));
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true })));
  expect(S.modals).toEqual([]);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('离线');
  click('重新验证已保存的登录'); expect(restoreSession).toHaveBeenCalled();
});
