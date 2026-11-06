import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api }));
import { S } from '@/state/store';
import { initialState } from '@/state/state';
import type { Conv } from '@/state/types';
import { savePreference } from './preferences';
import { desktopPermissionLabel, installBlockers, permissionPlan } from './permissionPlan';

const conv = (id: string, o: Partial<Conv> = {}): Conv => ({ id, owner: 'pc', title: '', updated: 0, messages: [], remote: true, ...o });
const desktop = conv('desk'), side = conv('side', { sideOf: 'desk' }), external = conv('ext', { agentId: 'codex' });
const personal = conv('pa', { personal: { id: 'pa_a', name: '小麓', directory: '/a' } });
const phone = conv('phone:dev:s1', { owner: 'dev', remote: false, phoneSession: 's1' });
const touched = () => [...new Set(m.api.mock.calls.map(c => String(c[1]).split('/')[3]))];

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); Object.assign(S, initialState());
  m.api.mockResolvedValue({ runtime: { has_task: true, is_processing: false } });
  S.permission = 'auto'; S.prefs.allowInstall = 'allow'; S.teams = [];
  S.convs = [desktop, side, external, personal, phone]; S.running = {};
});

it('REFACTOR-01-M4 AC-1 每个会话一份权限计划，不串到别的会话类型', () => {
  expect(permissionPlan(desktop)).toEqual({ policy: 'allow:auto', mode: 'yolo', followsInstall: true });
  expect(permissionPlan(side)).toEqual({ policy: 'side:readonly', mode: 'default', followsInstall: false });
  expect(permissionPlan(personal)).toMatchObject({ mode: 'default', followsInstall: false });
  expect(permissionPlan(external)).toBeUndefined(); // 外部 Agent 由它自己的选项适配处理
  expect(permissionPlan(desktop, 'ask')).toEqual({ policy: 'ask:auto', mode: 'default', followsInstall: true });
});

it('REFACTOR-01-M4 AC-2 改「命令与安装」只重新应用受影响的电脑任务，不重启个人助理和侧边聊天', async () => {
  await savePreference('allowInstall', 'ask');
  expect(touched()).toEqual(['desk']);
  expect(m.api).toHaveBeenCalledWith('PUT', '/api/conversations/desk/config-options/mode', { value: 'default' });
  expect(S.prefs.allowInstall).toBe('ask');
});

it('REFACTOR-01-M4 AC-3 手机、外部 Agent、个人助理、侧边聊天的任务在运行时不锁住这项设置', async () => {
  S.running = { [phone.id]: true, ext: true, pa: true, side: true };
  expect(installBlockers()).toEqual([]);
  await savePreference('allowInstall', 'deny');
  expect(S.prefs.allowInstall).toBe('deny');
});

it('REFACTOR-01-M4 AC-3 受影响的电脑任务或不认识的运行记录仍然拒绝修改', async () => {
  S.running = { desk: true };
  await expect(savePreference('allowInstall', 'deny')).rejects.toThrow('先停止');
  S.running = { unknown: true };
  await expect(savePreference('allowInstall', 'deny')).rejects.toThrow('先停止');
  expect(m.api).not.toHaveBeenCalled();
  expect(S.prefs.allowInstall).toBe('allow');
});

it('REFACTOR-01-M4 AC-4 所选档位与实际生效不一致时显示原因', () => {
  expect(desktopPermissionLabel('auto', 'allow')).toEqual({ name: '全自动' });
  expect(desktopPermissionLabel('auto', 'ask')).toEqual({ name: '全自动', note: '「命令与安装」设为询问，执行命令前仍需确认' });
  expect(desktopPermissionLabel('edits', 'deny').note).toContain('逐项确认');
  expect(desktopPermissionLabel('full', 'deny')).toEqual({ name: '完全访问' }); // 完全访问本身就是 yolo
  expect(desktopPermissionLabel('ask', 'deny')).toEqual({ name: '每次询问' });
});
