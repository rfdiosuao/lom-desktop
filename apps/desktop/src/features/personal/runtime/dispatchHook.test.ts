import { beforeEach, expect, it, vi } from 'vitest';
import { beginAuthChange } from '@/features/account/runtime/authScope';
import { S } from '@/state/store';
import type { Conv, Msg } from '@/state/types';

const m = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/features/chat/runtime/tasks', () => ({ sendFromChannel: m.send }));
import { dispatchNotice, inQuietHours, registerDispatchHook, tickDispatchHooks } from './dispatchHook';

const noon = new Date(2026, 10, 5, 12, 0, 0), midnight = new Date(2026, 10, 5, 23, 30, 0);
const T0 = noon.getTime() - 3_600_000; // 派发时刻：一小时前，没过期
let parent: Conv, child: Conv, turn: Msg;
beforeEach(() => {
  beginAuthChange(); localStorage.clear(); m.send.mockReset().mockResolvedValue({ id: 'notice' });
  S.cloud = 'signed-in'; S.conn = 'ready'; S.account = { id: 'hook-account', name: '', email: '' };
  parent = { id: 'hook-parent', owner: 'pc', title: 'PA', personal: { id: 'pa' }, messages: [] } as unknown as Conv;
  turn = { id: 'u1', type: 'user', at: T0 + 1_000, text: '做事' };
  child = { id: 'hook-child', owner: 'pc', title: '宣传片队长', messages: [turn] } as unknown as Conv;
  S.convs = [parent, child]; S.running = { [child.id]: true };
});

it('TEAM-ORCH-05 wakes the commander once, only after the platform records the turn as completed', async () => {
  registerDispatchHook(parent, child, T0);
  await tickDispatchHooks(noon);
  expect(m.send).not.toHaveBeenCalled();          // 还在跑
  delete S.running[child.id];
  await tickDispatchHooks(noon);
  expect(m.send).not.toHaveBeenCalled();          // 会话停了但平台还没给终态：不能凭“停了”就报完成
  turn.turnOutcome = 'completed';
  await tickDispatchHooks(noon); await tickDispatchHooks(noon);
  expect(m.send).toHaveBeenCalledTimes(1);
  expect(m.send).toHaveBeenCalledWith(parent, '来自「宣传片队长」的任务已完成', 'dispatch_done', expect.any(Function), undefined, { dispatchOf: child.id }); // TEAM-CHAT-01B 带上成员会话
});

it('TEAM-ORCH-05 registering the same dispatch again does not multiply notifications', async () => {
  registerDispatchHook(parent, child, T0); registerDispatchHook(parent, child, T0);
  delete S.running[child.id]; turn.turnOutcome = 'completed';
  await tickDispatchHooks(noon); await tickDispatchHooks(noon);
  expect(m.send).toHaveBeenCalledTimes(1);
});

it('TEAM-ORCH-05 a user-cancelled turn never wakes the commander; a failed one says so instead of claiming completion', async () => {
  registerDispatchHook(parent, child, T0); delete S.running[child.id]; turn.turnOutcome = 'cancelled';
  await tickDispatchHooks(noon);
  expect(m.send).not.toHaveBeenCalled();
  expect(dispatchNotice('x', 'failed')).not.toContain('已完成');
  registerDispatchHook(parent, child, T0); turn.turnOutcome = 'failed';
  await tickDispatchHooks(noon);
  expect(m.send).toHaveBeenCalledWith(parent, expect.stringContaining('失败'), 'dispatch_done', expect.any(Function), undefined, { dispatchOf: expect.any(String) }); // TEAM-CHAT-01B 带上成员会话
});

it('TEAM-ORCH-05 waits while the commander is mid-turn and holds the message through quiet hours', async () => {
  localStorage.setItem('lom.dispatch-hook.quiet', '23-8');
  registerDispatchHook(parent, child, T0); delete S.running[child.id]; turn.turnOutcome = 'completed';
  S.running[parent.id] = true;
  await tickDispatchHooks(noon);
  expect(m.send).not.toHaveBeenCalled();
  delete S.running[parent.id];
  await tickDispatchHooks(midnight);
  expect(m.send).not.toHaveBeenCalled();
  await tickDispatchHooks(noon);
  expect(m.send).toHaveBeenCalledTimes(1);
});

it('TEAM-ORCH-05 ignores turns older than the dispatch, other assistants and account switches', async () => {
  turn.at = T0 - 500; delete S.running[child.id]; turn.turnOutcome = 'completed';
  registerDispatchHook(parent, child, T0);
  await tickDispatchHooks(noon);
  expect(m.send).not.toHaveBeenCalled();
  turn.at = T0 + 1_000;
  S.account = { id: 'other-account', name: '', email: '' };
  await tickDispatchHooks(noon);
  expect(m.send).not.toHaveBeenCalled();
});

it('TEAM-ORCH-05 quiet hours are off by default and only apply when configured', async () => {
  expect(inQuietHours(midnight)).toBe(false);
  registerDispatchHook(parent, child, T0); delete S.running[child.id]; turn.turnOutcome = 'completed';
  await tickDispatchHooks(midnight);
  expect(m.send).toHaveBeenCalledTimes(1); // 夜里跑完的任务不用拖到早上
  localStorage.setItem('lom.dispatch-hook.quiet', '23-8');
  expect(inQuietHours(midnight)).toBe(true);
  expect(inQuietHours(new Date(2026, 10, 5, 7, 59))).toBe(true);
  expect(inQuietHours(noon)).toBe(false);
  localStorage.setItem('lom.dispatch-hook.quiet', 'garbage');
  expect(inQuietHours(midnight)).toBe(false);
});

it('TEAM-ORCH-05 a notice the target did not accept is retried and only abandoned, with a logged code, after 3 tries', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  registerDispatchHook(parent, child, T0); delete S.running[child.id]; turn.turnOutcome = 'completed';
  m.send.mockReset().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ id: 'ok' });
  await tickDispatchHooks(noon); await tickDispatchHooks(noon); await tickDispatchHooks(noon); await tickDispatchHooks(noon);
  expect(m.send).toHaveBeenCalledTimes(3); // 第三次成功后不再发
  registerDispatchHook(parent, child, T0);
  m.send.mockReset().mockResolvedValue(null);
  for (let i = 0; i < 5; i++) await tickDispatchHooks(noon);
  expect(m.send).toHaveBeenCalledTimes(3);
  expect(warn).toHaveBeenCalledWith('personal.dispatch_hook_send_failed', expect.objectContaining({ attempts: 3 }));
  warn.mockRestore();
});

it('TEAM-ORCH-05 a registration expires after 24 hours, with a logged code', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  registerDispatchHook(parent, child, noon.getTime() - 25 * 3_600_000); delete S.running[child.id]; turn.turnOutcome = 'completed'; turn.at = noon.getTime() - 24 * 3_600_000;
  await tickDispatchHooks(noon);
  expect(m.send).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith('personal.dispatch_hook_expired', expect.anything());
  warn.mockRestore();
});

it('TEAM-ORCH-05 over the limit the oldest registration is dropped with a logged code, never the new one', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const kids = Array.from({ length: 101 }, (_, i) => ({ id: `k${i}`, owner: 'pc', title: `k${i}`, messages: [] }) as unknown as Conv);
  S.convs = [parent, ...kids];
  kids.forEach(k => registerDispatchHook(parent, k, T0));
  expect(warn).toHaveBeenCalledWith('personal.dispatch_hook_evicted', { child: 'k0' });
  const last = kids[100]; last.messages.push({ id: 'u', type: 'user', at: T0 + 1_000, text: 'x', turnOutcome: 'completed' } as Msg);
  await tickDispatchHooks(noon);
  expect(m.send).toHaveBeenCalledWith(parent, expect.stringContaining('k100'), 'dispatch_done', expect.any(Function), undefined, { dispatchOf: expect.any(String) }); // TEAM-CHAT-01B 带上成员会话
  warn.mockRestore();
});
