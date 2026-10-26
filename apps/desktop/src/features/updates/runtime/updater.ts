import { useSyncExternalStore } from 'react';
export interface Update {
  version: string; body?: string;
  close(): Promise<void>;
  download(handler: (event: { event: 'Started'; data: { contentLength?: number } } | { event: 'Progress'; data: { chunkLength: number } } | { event: 'Finished' }) => void, options?: { timeout: number }): Promise<void>;
  install(): Promise<void>;
}
import { S } from '@/state/store';

export type UpdatePhase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';
export type UpdateState = { phase: UpdatePhase; version: string; notes: string; received: number; total?: number; error: string };
const initial: UpdateState = { phase: 'idle', version: '', notes: '', received: 0, error: '' };
/** D25: downloading never installs; installation is a separate user action. */
export function createUpdater(deps: { check: () => Promise<Update | null>; busy: () => boolean; restart: () => Promise<void> }) {
  let state = initial;
  let candidate: Update | null = null;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<UpdateState>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const fail = (e: unknown) => set({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
  return {
    snapshot: () => state,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async check() {
      if (['checking', 'downloading', 'ready', 'installing'].includes(state.phase)) return;
      set({ phase: 'checking', error: '' });
      try {
        const next = await deps.check();
        const previous = candidate; candidate = next;
        if (previous) await previous.close().catch(e => console.warn('updater.close_failed', e));
        set({ phase: next ? 'available' : 'current', version: next?.version || '', notes: next?.body || '', received: 0, total: undefined });
      } catch (e) { fail(e); }
    },
    async download() {
      if (!candidate || !['available', 'error'].includes(state.phase)) return;
      set({ phase: 'downloading', error: '', received: 0, total: undefined });
      try {
        await candidate.download(event => {
          if (event.event === 'Started') set({ total: event.data.contentLength });
          if (event.event === 'Progress') set({ received: state.received + event.data.chunkLength });
        }, { timeout: 300000 });
        // The plugin verifies the signature before download() resolves.
        set({ phase: 'ready' });
      } catch (e) { fail(e); }
    },
    async install() {
      if (!candidate || state.phase !== 'ready') return;
      if (deps.busy()) { set({ error: '还有任务正在运行，请等任务结束后再安装。' }); return; }
      set({ phase: 'installing', error: '' });
      try {
        await candidate.install();
        // On Windows the installer exits/restarts the app itself.
        await deps.restart();
      } catch (e) { fail(e); }
    },
  };
}
export const updateBusy = () => Object.values(S.running).some(Boolean) || Object.keys(S.pending).length > 0;
export const desktopUpdater = createUpdater({
  check: async () => { throw new Error('开源版未配置自动更新，请从公开仓库获取源码并自行构建。'); },
  busy: updateBusy,
  restart: async () => {},
});
export const useUpdater = () => useSyncExternalStore(desktopUpdater.subscribe, desktopUpdater.snapshot);
export function startUpdateChecks() { return () => {}; }
