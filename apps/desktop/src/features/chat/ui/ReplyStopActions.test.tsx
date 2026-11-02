import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';

const m = vi.hoisted(() => ({ api: vi.fn(), admissions: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api }));
vi.mock('@/features/teams/runtime/delegationLifecycle', () => ({ invalidateDelegations: vi.fn(), stopDelegationAdmissions: m.admissions }));
import { MessageList } from './MessageList';
import { isTaskStopping, stopChildTask } from '../runtime/cancel';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  S.convs = [{ id: 'quiet', owner: 'pc', title: '成员任务', remote: true, updated: 1,
    messages: [{ id: 'reply', type: 'assistant', text: '部分回复', at: 1 }] }];
  S.eventOpen = {}; S.running = { quiet: true }; S.teams = [];
  m.api.mockResolvedValue({ runtime: { is_processing: false, turn_id: null } });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('D31 AC-4 quiet stop releases actions reactively after all cancellation work settles', async () => {
  let finish!: (value: { stopped: number; failed: number }) => void;
  m.admissions.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await act(async () => root.render(<MessageList msgs={S.convs[0].messages} ctxId="quiet" />));
  let stopped!: ReturnType<typeof stopChildTask>;
  await act(async () => { stopped = stopChildTask('quiet'); });
  expect(S.running.quiet).toBeUndefined();
  expect(isTaskStopping('quiet')).toBe(true);
  expect(host.querySelector('.msg--actions')).toBeNull();
  await act(async () => { finish({ stopped: 0, failed: 0 }); await stopped; });
  expect(isTaskStopping('quiet')).toBe(false);
  // No explicit root.render/update: guard settlement must notify the mounted list.
  expect(host.querySelectorAll('.msg--actions')).toHaveLength(1);
});
