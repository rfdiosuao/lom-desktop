import { confirm } from '@/shared/overlays/controller';
import { S, update, watchStore } from '@/state/store';
/** Approval is bound to one live desktop request, never bypassed by full access. */
export function approveCapability(summary: string, current: () => boolean): Promise<boolean> {
  if (!current()) return Promise.resolve(false);
  return new Promise(resolve => {
    let done = false;
    const finish = (allowed: boolean) => {
      if (done) return;
      done = true; clearTimeout(timer); stop();
      // The confirm component owns removal; never pop a different modal.
      queueMicrotask(() => update(s => { const i = s.modals.indexOf(modal); if (i >= 0) s.modals.splice(i, 1); }));
      resolve(allowed && current());
    };
    confirm({ title: '批准助理能力操作', desc: summary, okText: '允许一次', onOk: () => finish(true) });
    const modal = S.modals.at(-1)!;
    const timer = setTimeout(() => finish(false), 60_000);
    const stop = watchStore(() => {
      if (!current()) finish(false);
      else if (!S.modals.includes(modal)) queueMicrotask(() => { if (!done) finish(false); });
    });
  });
}
