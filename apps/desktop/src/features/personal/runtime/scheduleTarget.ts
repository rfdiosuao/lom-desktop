import { personalConversation, type PersonalAssistant } from './catalog';
import type { Schedule } from '@/state/types';

/* ===== REFACTOR-01 模块 6（#280）第一步：个人助理定时任务的执行目标只在这里解析 =====
 * 用户新建任务和默认心跳原来各自拼装会话、模型、工作区，归属核对也不一致。现在共用：
 * 核对助理与会话归属 → 取会话的 Lom 模型、助理工作区和名字 → 生成按原会话运行、每次询问权限的任务草稿。
 * 保存、启用、模型可用性仍由 schedules/runtime 的 saveCoreSchedule / scheduleGuard 负责。 */

export interface PersonalScheduleTarget {
  conversationId: string;
  agentConfig: { name: string; workspace: string; model: { provider_id: string; model: string } };
}

export function personalScheduleTarget(a: PersonalAssistant): PersonalScheduleTarget {
  const c = personalConversation(`personal:${a.id}`);
  if (!c || c.id !== a.conversation || c.personal?.directory !== a.directory) throw new Error('定时任务的助理归属不一致');
  const [providerFromId, ...rest] = (c.modelId || '').split('::');
  const provider = c.providerId || providerFromId, model = rest.join('::');
  if (!provider || !model) throw new Error('请先连接Lom模型');
  return { conversationId: c.id, agentConfig: { name: a.name, workspace: a.workspace, model: { provider_id: provider, model } } };
}

type Timing = Pick<Schedule, 'freq' | 'time'> & Partial<Pick<Schedule, 'cron' | 'scheduleDescription'>>;

/** 个人助理任务草稿：在助理原会话里运行，权限为每次询问 */
export function personalScheduleDraft(a: PersonalAssistant, task: { name: string; prompt: string; enabled?: boolean }, timing: Timing): Schedule {
  const target = personalScheduleTarget(a);
  return {
    id: '', name: task.name, prompt: task.prompt, exec: 'pc', enabled: task.enabled ?? true,
    days: [], every: 60, runIn: 'same', runMode: 'default', last: null, runs: [], ...timing,
    conversationId: target.conversationId, agentConfig: target.agentConfig,
  };
}
