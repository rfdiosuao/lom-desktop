import { onAuthChange } from '@/features/account/runtime/authScope';
import { toast } from '@/shared/overlays/controller';
import { S, watchStore } from '@/state/store';

/* ===== D36：任务运行中也能切模型、切推理强度 =====
 * 正在执行的这一轮不能中途换模型（会打断它），所以先记下来，这一轮一结束就自动切换；
 * 同一任务后选的覆盖先选的。切换本身仍走原来的确认流程，失败照常提示并保留原设置。 */

export interface PendingSwitch { model?: string; effort?: string }
type Apply = (id: string, change: PendingSwitch) => Promise<void>;

const pending = new Map<string, PendingSwitch>();
let applier: Apply | undefined;
onAuthChange(() => pending.clear());

/** 由 tasks 注册真正执行切换的函数（避免循环引用） */
export const setSwitchApplier = (fn: Apply) => { applier = fn; };

export function deferSwitch(id: string, change: PendingSwitch, label: string) {
  pending.set(id, { ...pending.get(id), ...change });
  toast(`这一轮结束后切换到「${label}」`, change.model ? 'cube' : 'brain');
}

export const pendingSwitch = (id: string) => pending.get(id);

watchStore(() => {
  for (const [id, change] of [...pending]) {
    if (S.running[id]) continue;
    pending.delete(id);
    void applier?.(id, change).catch(e => console.warn('switch.deferred_failed', e));
  }
});
