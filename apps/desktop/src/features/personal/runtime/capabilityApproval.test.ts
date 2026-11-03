import { expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import { approveCapability } from './capabilityApproval';
it('PA-CAPABILITY-01 actual confirm lifecycle closes first then invokes approval without false denial', async () => {
  const pending = approveCapability('Create blank assistant', () => true);
  const modal = S.modals.at(-1)!;
  update(s => { s.modals.pop(); });
  (modal.props.onOk as () => void)();
  expect(await pending).toBe(true);
});
it('PA-CAPABILITY-01 dismissal alone denies and does not close an unrelated modal', async () => {
  const pending = approveCapability('Remember fact', () => true);
  update(s => { s.modals.pop(); s.modals.push({ id: 'unrelated', props: {} }); });
  expect(await pending).toBe(false);
  expect(S.modals.at(-1)?.id).toBe('unrelated');
});

it('PA-CAPABILITY-01 approval expires without a mutation or leaked pending modal', async () => {
  vi.useFakeTimers();
  try {
    const pending = approveCapability('Remember fact', () => true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toBe(false); expect(S.modals).toHaveLength(0);
  } finally { vi.useRealTimers(); }
});
