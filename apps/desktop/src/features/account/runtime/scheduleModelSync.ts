import { update } from '@/state/store';
import { reconcileSchedules } from './modelReconcile';
import type { CloudModels, LegacyModels } from './modelBinding';

let pending: Promise<void> | null = null;
let rerun: (() => void) | null = null;
/** Cron maintenance must never hold up an interactive model configuration refresh. */
export function syncScheduleModels(provider: string, models: CloudModels, legacy: LegacyModels, current: () => boolean) {
  if (pending) { rerun = () => syncScheduleModels(provider, models, legacy, current); return; }
  if (!current()) return;
  const work = reconcileSchedules(provider, models, legacy, current).then(issues => {
    if (current()) update(s => { s.cloudScheduleError = issues.length ? `${issues.length} 个定时任务的模型未同步，请检查定时任务配置；聊天模型已同步，不受影响。` : ''; });
  }, () => {
    // Raw core errors can contain internal details. Report the failed subsystem independently.
    if (current()) update(s => { s.cloudScheduleError = '定时任务模型同步未完成，请检查核心连接后重新同步；聊天模型已同步，不受影响。'; });
  }).finally(() => {
    if (pending !== work) return;
    pending = null; const next = rerun; rerun = null; next?.();
  });
  pending = work;
}
