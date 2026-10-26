import { expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { Conv } from '@/state/types';

const { recoverTaskHistory, refreshWorkspace } = vi.hoisted(() => ({
  recoverTaskHistory: vi.fn(() => Promise.resolve()), refreshWorkspace: vi.fn(),
}));
vi.mock('./recovery', () => ({ recoverTaskHistory }));
vi.mock('@/features/workspace/runtime/workspace', () => ({ refreshWorkspace }));

it('D26 重新打开已加载的任务时重试完整受保护的历史恢复', async () => {
  const c: Conv = { id: 'reopen', owner: 'pc', title: '任务', updated: 0, loaded: true, remote: true,
    agentId: 'external', messages: [{ id: 'partial', type: 'assistant', at: 1, text: '旧的局部回复', streaming: true }] };
  update(s => { s.convs = [c]; s.running[c.id] = true; });
  const { openTask } = await import('./tasks');
  await openTask(c.id);
  expect(recoverTaskHistory).toHaveBeenCalledWith(c);
  expect(refreshWorkspace).toHaveBeenCalled();
  expect(S.convs[0]).toBe(c);
});
