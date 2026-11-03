import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
vi.mock('@/features/chat/ui/Message', () => ({ Message: ({ m, ctxId }: { m: { id: string }; ctxId: string }) => <div data-confirm={m.id}>{ctxId}</div> }));
import { MemberWait } from './MemberWait';
import type { Conv } from '@/state/types';
it('TEAM-WAIT-01 member wait opens the actual message in its conversation context', async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host);
  const c = { id: 'worker', messages: [{ id: 'confirm', type: 'approval', status: 'pending', toolName: 'lom_search', at: Date.now() - 32000 }] } as Conv;
  await act(async () => root.render(<MemberWait c={c} name="成员" />));
  expect(host.textContent).toContain('等待授权 · lom_search · 已等待 32 秒');
  expect(host.querySelector('[data-confirm]')).toBeNull();
  await act(async () => host.querySelector('button')!.click());
  expect(host.querySelector('[data-confirm="confirm"]')?.textContent).toBe('conv:worker');
  await act(async () => root.unmount());
});
