import { authRevision } from '@/features/account/runtime/authScope';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';

const generations = new Map<string, number>();
const admissions = new Map<string, Set<Promise<boolean>>>();

/** Called synchronously when stopping begins, before any cancellation requests. */
export function invalidateDelegations(parent: string) {
  generations.set(parent, (generations.get(parent) || 0) + 1);
}

export function captureDelegation(parent: Conv) {
  const expected = generations.get(parent.id), currentAccount = authRevision(), account = S.account?.id;
  return () => generations.get(parent.id) === expected && currentAccount() && S.account?.id === account && S.convs.includes(parent);
}

/** Keep stop unconfirmed until in-flight admissions and any late cleanup have settled. */
export function trackDelegation<T>(parent: string, work: Promise<T>): Promise<T> {
  const pending = admissions.get(parent) || new Set<Promise<boolean>>();
  const settled = work.then(() => true, () => false);
  pending.add(settled); admissions.set(parent, pending);
  void settled.then(() => { pending.delete(settled); if (!pending.size) admissions.delete(parent); });
  return work;
}

export async function stopDelegationAdmissions(parent: string) {
  const results = await Promise.all([...(admissions.get(parent) || [])]);
  return { stopped: 0, failed: results.filter(ok => !ok).length };
}
