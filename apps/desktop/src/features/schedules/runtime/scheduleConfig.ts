import { LOM_PROVIDER_NAME } from '@/features/account/runtime/builtin';
import { personalConversation } from '@/features/personal/runtime/catalog';
import { S } from '@/state/store';
import { currentPcModel, modelChoice, pcModels } from '@/state/selectors';
import type { ModelOption, Schedule } from '@/state/types';

/* ===== REFACTOR-01 模块 6（#280）第二步：定时任务配置解析 =====
 * 创建、编辑、启用原来各自判断模型：编辑时只按档位解析，Lom Pro / Max 共用同一个物理模型时解析不到，
 * 能用的任务被报「模型已失效」；启用普通任务则完全不检查，已删除的模型照样启用、到点才失败。
 * 现在三者都走这里；这里只解析配置，不调用核心接口，操作与对账留在 schedules.ts。 */

export type PersonalScheduleScope = { personalId: string; beforeCreate?: () => void };
type SavedModel = { provider_id?: string; model?: string };

const savedModel = (f: Schedule) => f.agentConfig?.model as SavedModel | undefined;
/** 自带 CLI 的外部 Agent 任务用它自己的模型配置，不按 Lom 模型校验 */
const usesLomModel = (f: Schedule) => !f.agentConfig?.cli_path;

/** 任务配置的模型解析成当前可选项 */
export function resolveScheduleModel(f: Schedule, scope?: PersonalScheduleScope): ModelOption | undefined {
  const selected = savedModel(f);
  const c = scope ? personalConversation(`personal:${scope.personalId}`) : undefined;
  const id = selected ? `${selected.provider_id}::${selected.model}` : c?.modelId;
  if (!id) return currentPcModel();
  // 物理模型仍由某个可用选项提供：执行只看物理模型，档位歧义（Pro / Max 共用）不影响
  const direct = pcModels().find(m => !m.unavailable && m.id === id);
  if (direct) return direct;
  const cloud = S.providers.find(p => p.enabled && p.name === LOM_PROVIDER_NAME);
  const tier = c && id === c.modelId && id.startsWith(`${cloud?.id}::`) ? c.lomTier : undefined;
  return modelChoice(id, tier);
}

/** 这份配置现在能否运行；能运行返回 undefined。个人助理只能用 Lom 账号模型 */
export function scheduleModelProblem(f: Schedule, scope?: PersonalScheduleScope): string | undefined {
  if (!scope && !usesLomModel(f)) return undefined;
  const choice = resolveScheduleModel(f, scope);
  if (scope) return !choice?.model || choice.byok || choice.unavailable ? '个人助理只能使用可用的Lom账号模型' : undefined;
  if (!savedModel(f)) return undefined; // 旧任务没有记录模型：由核心按默认配置运行，不在这里拦截
  return !choice?.model || choice.unavailable ? '定时任务模型已失效，请编辑任务重新选择模型' : undefined;
}
