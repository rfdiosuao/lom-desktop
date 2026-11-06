import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api }));
import { S } from '@/state/store';
import { initialState } from '@/state/state';
import type { Conv } from '@/state/types';
import { savePreference } from './preferences';
import { effectiveMode, INSTALL_POLICY_LABELS } from './permissionPlan';

const conv = (id: string, title = id): Conv => ({ id, owner: 'pc', title, updated: 0, messages: [], remote: true });
const modeCalls = () => m.api.mock.calls.filter(c => c[0] === 'PUT').map(c => `${String(c[1]).split('/')[3]}=${(c[3] as { value: string } | undefined)?.value ?? (c[2] as { value: string }).value}`);
let failOn: string[] = [];

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); Object.assign(S, initialState());
  failOn = [];
  m.api.mockImplementation(async (method: string, path: string, body?: { value?: string }) => {
    if (method === 'PUT' && failOn.includes(`${path.split('/')[3]}=${body?.value}`)) throw new Error('核心拒绝了请求');
    return { runtime: { has_task: true, is_processing: false } };
  });
  S.permission = 'auto'; S.prefs.allowInstall = 'allow'; S.teams = []; S.running = {};
  S.convs = [conv('a', '会话甲'), conv('b', '会话乙'), conv('c', '会话丙')];
});

it('SET-PERM-01 #424 核心只有三种模式，没有拒绝：「禁止」的名称不得宣称拒绝，且与「始终询问」可区分', () => {
  expect(INSTALL_POLICY_LABELS.deny).not.toMatch(/禁止|拒绝/);
  expect(INSTALL_POLICY_LABELS.deny).not.toBe(INSTALL_POLICY_LABELS.ask);
  // 可区分：自动编辑档位下，「始终询问」仍自动改文件，另一档连写文件也要确认
  expect(effectiveMode('edits', 'ask')).toBe('auto_edit');
  expect(effectiveMode('edits', 'deny')).toBe('default');
  // 任何一档都不会得到比「逐项确认」更严的核心模式
  for (const p of ['ask', 'edits', 'auto', 'readonly']) expect(effectiveMode(p, 'deny')).toBe('default');
});

it('SET-PERM-01 #425 中途失败时已改的会话回滚到旧模式，设置保持旧值并如实说明', async () => {
  failOn = ['c=default'];
  const error = await savePreference('allowInstall', 'ask').catch(e => e as Error);
  expect(error).toBeInstanceOf(Error);
  expect(S.prefs.allowInstall).toBe('allow');
  // a、b 先改成 default，c 失败，随后 a、b 恢复为 yolo
  expect(modeCalls()).toEqual(expect.arrayContaining(['a=default', 'b=default', 'a=yolo', 'b=yolo']));
  expect((error as Error).message).toContain('permission.install_policy_failed');
  expect((error as Error).message).toContain('已恢复');
  expect((error as Error).message).not.toContain('未能恢复');
});

it('SET-PERM-01 #425 回滚本身也失败时，列出哪些会话没有恢复，不能显示旧策略', async () => {
  failOn = ['c=default', 'a=yolo'];
  const error = await savePreference('allowInstall', 'ask').catch(e => e as Error);
  expect(S.prefs.allowInstall).toBe('allow');
  expect((error as Error).message).toContain('permission.install_policy_partial');
  expect((error as Error).message).toContain('会话甲');
  expect((error as Error).message).not.toContain('会话乙');
});

it('SET-PERM-01 #425 核心团队同样参与回滚', async () => {
  S.teams = [{ id: 't1', name: '团队一', core: { id: 'ct1' } } as never];
  failOn = ['a=default'];
  await expect(savePreference('allowInstall', 'ask')).rejects.toThrow('permission.install_policy');
  const posts = m.api.mock.calls.filter(c => c[0] === 'POST' && String(c[1]).includes('/session-mode')).map(c => (c[2] as { mode: string }).mode);
  expect(posts).toEqual(['default', 'yolo']);
  expect(S.prefs.allowInstall).toBe('allow');
});

it('SET-PERM-01 #425 全部成功才更新设置', async () => {
  await savePreference('allowInstall', 'ask');
  expect(S.prefs.allowInstall).toBe('ask');
  expect(modeCalls()).toEqual(['a=default', 'b=default', 'c=default']);
});
