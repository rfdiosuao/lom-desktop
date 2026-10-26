import { expect, it, vi } from 'vitest';

const { connectEvents, refreshTaskList, recoverLoadedTasks, handleCoreEvent, retryDeferredRecovery, syncCoreAccount } = vi.hoisted(() => ({
  connectEvents: vi.fn(), refreshTaskList: vi.fn(() => Promise.resolve()),
  recoverLoadedTasks: vi.fn(() => Promise.resolve()), handleCoreEvent: vi.fn(), retryDeferredRecovery: vi.fn(),
  syncCoreAccount: vi.fn(() => Promise.resolve()),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }));
vi.mock('@/core/client', () => ({ CoreError: class extends Error {}, getEndpoint: vi.fn(), setEndpoint: vi.fn() }));
vi.mock('@/core/events', () => ({ connectEvents }));
vi.mock('@/features/chat/runtime/taskSync', () => ({ refreshTaskList }));
vi.mock('@/features/chat/runtime/stream', () => ({ handleCoreEvent }));
vi.mock('@/features/chat/runtime/recovery', () => ({ recoverLoadedTasks, retryDeferredRecovery }));
vi.mock('@/features/phones/runtime/collaborationSettings', () => ({ startSupervision: vi.fn() }));
vi.mock('@/features/phones/runtime/phoneSync', () => ({ startPhoneSync: vi.fn() }));
vi.mock('@/features/phones/runtime/devices', () => ({ startDevicesTimer: vi.fn(), syncDevices: vi.fn() }));
vi.mock('@/features/account/runtime/cloud', () => ({ syncCoreAccount, startPointsTimer: vi.fn() }));
vi.mock('@/features/schedules/runtime/schedules', () => ({ syncSchedules: vi.fn() }));
vi.mock('@/features/settings/runtime/providerSync', () => ({ refreshProviders: vi.fn() }));
vi.mock('@/features/workspace/runtime/workspace', () => ({ refreshWorkspace: vi.fn() }));

it('D26 WebSocket 重连刷新列表后恢复会话，正常首连不重复加载历史', async () => {
  const { startCore } = await import('./bootstrap');
  await startCore();
  const callbacks = connectEvents.mock.calls[0][0];
  callbacks.onOpen(false);
  expect(recoverLoadedTasks).not.toHaveBeenCalled();
  expect(syncCoreAccount).toHaveBeenCalledTimes(1);
  callbacks.onOpen(true);
  await vi.waitFor(() => expect(recoverLoadedTasks).toHaveBeenCalledTimes(1));
  expect(refreshTaskList).toHaveBeenCalledTimes(2);
  expect(syncCoreAccount).toHaveBeenCalledTimes(2);
  const event = { name: 'turn.completed', data: { conversation_id: 'c1', status: 'finished' } };
  callbacks.onEvent(event);
  expect(handleCoreEvent).toHaveBeenCalledWith(event);
  expect(retryDeferredRecovery).toHaveBeenCalledWith('c1');
  expect(handleCoreEvent.mock.invocationCallOrder[0]).toBeLessThan(retryDeferredRecovery.mock.invocationCallOrder[0]);
});
