import type { CommandSkill } from '@/features/chat/runtime/commandSkills';

/* ===== 核心自带、但不该出现在 Lom 菜单里的技能 =====
 * 这些是上游内置的技能：管理 AionUi 自身、安装第三方 agent 框架、或给 Agent 自己调用的内部工具
 * （定时任务另有命令入口）。名单是上游的真实技能名，因此本文件登记在 naming-allowlist.txt。
 * 只隐藏内置来源，用户自建的同名技能照常显示；Agent 仍可自行调用。 */

const HIDDEN_BUILTIN = new Set(['openclaw-setup', 'session-message', 'conversation-create', 'cron']);

export const isInternalSkill = (skill: CommandSkill) =>
  skill.source === 'builtin' && (skill.name.startsWith('aionui-') || HIDDEN_BUILTIN.has(skill.name));
