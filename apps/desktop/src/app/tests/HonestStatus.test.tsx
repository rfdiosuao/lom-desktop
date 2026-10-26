import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { S, update } from '@/state/store';
import { Settings } from '@/features/settings/ui/Settings';
import { Workspace } from '@/features/workspace/ui/Workspace';
import { FullModal } from '@/features/workspace/ui/FullModal';
import { PhoneSubagents } from '@/features/phones/ui/PhonePages';

let host: HTMLDivElement, root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

it('D10 设置真实开关与配对授权，不显示演示权限', () => {
  S.settingsPage = 'general'; S.prefs.launchAtLogin = true; S.prefs.sound = true;
  act(() => root.render(<Settings />));
  expect(host.querySelector('[role="switch"][aria-label="提示音"]')).not.toBeNull();
  expect(host.querySelector('[role="switch"][aria-label="开机自动启动"]')).not.toBeNull();
  expect(host.textContent).toContain('试听');
  expect(host.textContent).not.toContain('暂未接入');
  act(() => update(s => { s.settingsPage = 'security'; s.prefs.allowInstall = 'deny'; }));
  expect(host.textContent).toContain('禁止命令和写入');
  expect(host.textContent).not.toContain('此处授权列表为示例');
  expect([...host.querySelectorAll('button')].some(x => x.textContent === '禁止')).toBe(false);
});

it('D06 AC8 / R02-03 真实手机未登录时不冒用静态示例，全屏也不展示假画面', () => {
  S.wsTab = 'phone'; S.live = true; S.cloud = 'signed-out'; S.agents[S.phoneId].real = true;
  act(() => root.render(<Workspace />));
  expect(host.textContent).toContain('请先登录');
  expect(host.querySelector('.mirror')).toBeNull();
  expect(host.querySelector('img')).toBeNull();
  act(() => root.render(<FullModal />));
  expect(host.textContent).toContain('请先登录');
  expect(host.querySelector('.mirror')).toBeNull();
});

it('PHONE-01 / D06 AC6/7 子代理示例不能伪装成真实手机配置', () => {
  act(() => root.render(<PhoneSubagents />));
  expect(host.querySelector('[role="switch"]')).toBeNull();
  expect(host.textContent).toContain('示例手机不能同步或执行子代理');
  expect(host.querySelector('button')).toBeNull();
  expect(host.textContent).not.toContain('已启用');
});
