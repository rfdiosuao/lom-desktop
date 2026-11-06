import { initialState } from '@/state/state';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.hoisted(() => vi.stubEnv('VITE_LOM_CLOUD_URL', 'https://service.example.invalid'));
import { S } from '@/state/store';
import { Settings } from './Settings';

let host: HTMLDivElement, root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { Object.assign(S, initialState(true)); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

it('SET-ACCOUNT-01 #429 账号页没有对应内容的入口：不再显示指向「权限与安全」的「已登录的电脑 → 管理」', () => {
  S.settingsPage = 'account'; S.cloud = 'signed-in';
  S.account = { id: 'a', name: '测试', email: 'a@example.test' } as typeof S.account;
  act(() => root.render(<Settings />));
  expect(host.textContent).toContain('退出登录');
  expect(host.textContent).not.toContain('已登录的电脑');
  expect([...host.querySelectorAll('button')].some(b => b.textContent === '管理')).toBe(false);
});
