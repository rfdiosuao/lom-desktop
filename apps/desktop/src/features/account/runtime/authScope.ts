import { S } from '@/state/store';

let revision = 0;
const listeners = new Set<() => void>();
export function onAuthChange(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export type AuthGuard = () => boolean;

/** Invalidate pending account work before any asynchronous login/logout operation. */
export function beginAuthChange(): AuthGuard {
  const expected = ++revision;
  for (const listener of listeners) listener();
  return () => revision === expected;
}

export function authRevision(): AuthGuard {
  const expected = revision;
  return () => revision === expected;
}

/** Includes the revision so logging back into the same account cannot revive old work. */
export function authAccount(): AuthGuard {
  const current = authRevision(), account = S.account?.id;
  return () => current() && !!account && S.cloud === 'signed-in' && S.account?.id === account;
}
