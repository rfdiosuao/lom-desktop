import { initialState } from '@/state/state';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { S } from '@/state/store';
import { AuditModal } from './AuditModal';

const KEY = 'lom-audit-v1:local';
let host: HTMLDivElement, root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { localStorage.clear(); Object.assign(S, initialState()); S.account = null; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

it('SET-AUDIT-01 #430 说明里写明保留条数和存储位置', () => {
  act(() => root.render(<AuditModal />));
  expect(document.body.textContent).toContain('1000');
  expect(document.body.textContent).toMatch(/浏览器|localStorage/);
  expect(document.body.textContent).toContain('清除网站数据');
});

it('SET-AUDIT-01 #430 因超出上限删除过记录时，界面如实说明删了多少条', () => {
  localStorage.setItem(`${KEY}:trimmed`, '12');
  act(() => root.render(<AuditModal />));
  expect(document.body.textContent).toContain('已删除最早的 12 条');
});

it('SET-AUDIT-01 #430 数据损坏时显示错误码和「备份并重建」，点击后原文备份、列表恢复可用', () => {
  localStorage.setItem(KEY, '{bad');
  act(() => root.render(<AuditModal />));
  expect(document.body.textContent).toContain('audit.corrupt');
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent === '备份并重建');
  expect(btn).toBeTruthy();
  act(() => btn!.click());
  expect(localStorage.getItem(`${KEY}:corrupt`)).toBe('{bad');
  expect(localStorage.getItem(KEY)).toBeNull();
  expect(document.body.textContent).not.toContain('audit.corrupt');
  expect(document.body.textContent).toContain('暂无操作记录');
});
