import { api } from '@/core/client';
import { S } from '@/state/store';
import { effectiveMode, installAffected, permissionPlan } from './permissionPlan';

/* ===== SET-PERM-01：「命令与安装」的原子应用（#425） =====
 * 一次改动要同时落到核心团队和多个电脑会话。任何一步失败，已改的都要恢复到旧模式，
 * 全部成功后调用方才更新界面上的设置；恢复也失败的会话如实列出，不能显示旧策略却实际部分生效。 */

/** 每个会话最近一次应用成功的策略标识；变化时才需要清掉旧的「总是允许」 */
export const applied = new Map<string, string>();

export async function resetApprovals(id: string) {
  const info = await api<{ runtime?: { has_task?: boolean; is_processing?: boolean } }>('GET', `/api/conversations/${id}`);
  if (info.runtime?.is_processing) throw new Error('任务正在执行，未更改权限');
  await api('POST', `/api/conversations/${id}/runtime/${info.runtime?.has_task ? 'restart' : 'ensure'}`, {});
}

interface Step { name: string; apply(): Promise<void>; revert(): Promise<void> }

const teamStep = (id: string, name: string, from: string, to: string): Step => ({
  name,
  apply: () => api('POST', `/api/teams/${id}/session-mode`, { mode: to }).then(() => undefined),
  revert: () => api('POST', `/api/teams/${id}/session-mode`, { mode: from }).then(() => undefined),
});

function planSteps(next: string): Step[] {
  const prev = S.prefs.allowInstall;
  const steps: Step[] = [];
  for (const t of S.teams) if (t.core) steps.push(teamStep(t.core.id, t.name, effectiveMode(S.permission, prev), effectiveMode(S.permission, next)));
  for (const c of installAffected(next)) {
    const to = permissionPlan(c, next)!, from = permissionPlan(c, prev)!;
    steps.push({
      name: c.title || c.id,
      apply: async () => {
        await resetApprovals(c.id);
        await api('PUT', `/api/conversations/${c.id}/config-options/mode`, { value: to.mode });
        applied.set(c.id, to.policy);
      },
      revert: async () => {
        await api('PUT', `/api/conversations/${c.id}/config-options/mode`, { value: from.mode });
        applied.set(c.id, from.policy);
      },
    });
  }
  return steps;
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 40);
const names = (list: string[]) => list.length > 2 ? `${list.slice(0, 2).join('、')}等 ${list.length} 个` : list.join('、');

/** 逐个应用；失败时恢复已尝试过的步骤（包括失败的那一步，它的状态无法确认），然后抛出说明结果的错误 */
export async function applyInstallPolicy(next: string) {
  const steps = planSteps(next);
  const attempted: Step[] = [];
  for (const step of steps) {
    attempted.push(step);
    try { await step.apply(); } catch (e) {
      console.warn('permission.install_policy_failed', step.name, e);
      throw await failure(step, attempted, steps.length, e);
    }
  }
}

async function failure(failed: Step, attempted: Step[], total: number, cause: unknown): Promise<Error> {
  const stuck: string[] = [];
  for (const step of attempted.slice().reverse()) {
    try { await step.revert(); } catch (e) { console.warn('permission.install_policy_revert_failed', step.name, e); stuck.push(step.name); }
  }
  const head = `「${failed.name}」没有更新（${reason(cause)}）`;
  const rest = total - attempted.length ? `，其余 ${total - attempted.length} 个未改动` : '';
  if (!stuck.length) return new Error(`命令与安装未保存，设置保持原样（permission.install_policy_failed）：${head}${rest}，已改的已恢复。`);
  return new Error(`命令与安装未保存，但这些会话未能恢复旧模式（permission.install_policy_partial）：${names(stuck)}。${head}。请重试或重启这些会话。`);
}
