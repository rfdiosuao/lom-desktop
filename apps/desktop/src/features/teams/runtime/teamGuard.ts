import type { Team } from '@/state/types';
import { update } from '@/state/store';
import { api } from '@/core/client';
export const teamAlways = () => true;
export function assertTeamCurrent(current: () => boolean) {
  if (!current()) throw new Error('团队操作已停止或账号、目标已变化；已发出请求请核对，勿自动重试');
}
export async function teamStep<T>(current: () => boolean, work: () => Promise<T>): Promise<T> {
  assertTeamCurrent(current); const value = await work(); assertTeamCurrent(current); return value;
}
export function teamRequest<T>(current: () => boolean, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) {
  return teamStep(current, () => current === teamAlways
    ? body === undefined ? api<T>(method, path) : api<T>(method, path, body)
    : api<T>(method, path, body, { timeoutMs: 10000 }));
}

const epochs = new WeakMap<Team, number>();
const pending = new WeakMap<Team, number>();
export const teamEpoch = (t: Team) => epochs.get(t) ?? 0;
export function invalidateTeamOperations(t: Team) { epochs.set(t, teamEpoch(t) + 1); update(); }
export const teamOperationPending = (t: Team) => (pending.get(t) ?? 0) > 0;
export function beginTeamOperation(t: Team) {
  pending.set(t, (pending.get(t) ?? 0) + 1); update();
  return () => { pending.set(t, Math.max(0, (pending.get(t) ?? 0) - 1)); update(); };
}

/** Missing/invalid run state is unknown, never a successful idle observation. */
export function observedTeamRun(state: unknown): string | null {
  if (state && typeof state === 'object' && !Array.isArray(state) && Object.hasOwn(state, 'active_run')) {
    const run = (state as { active_run: unknown }).active_run;
    if (run === null) return null;
    if (run && typeof run === 'object' && !Array.isArray(run)) {
      const id = (run as { team_run_id?: unknown }).team_run_id;
      if (typeof id === 'string' && id.trim() && id.length <= 256) return id;
    }
  }
  throw new Error('团队运行状态不完整，结果未知');
}
