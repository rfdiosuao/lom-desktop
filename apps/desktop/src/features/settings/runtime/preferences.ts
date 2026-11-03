import { personalFullAccess } from '@/features/personal/runtime/permissions';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { S, update } from '@/state/store';
import { effectiveMode, installAffected, installBlockers, permissionPlan } from './permissionPlan';
import { api } from '@/core/client';
import { nativeFullAccess } from '@/state/selectors';
import type { Conv } from '@/state/types';

export { effectiveMode } from './permissionPlan';
export async function syncStartupPreference() {
  if (!isTauri()) return;
  const value = await invoke<boolean>('login_start_enabled');
  update(s => { s.prefs.launchAtLogin = value; });
}
const pending = new Set<string>();
const applied = new Map<string, string>();
async function resetApprovals(id: string) {
  const info = await api<{ runtime?: { has_task?: boolean; is_processing?: boolean } }>('GET', `/api/conversations/${id}`);
  if (info.runtime?.is_processing) throw new Error('任务正在执行，未更改权限');
  await api('POST', `/api/conversations/${id}/runtime/${info.runtime?.has_task ? 'restart' : 'ensure'}`, {});
}
/** `restarted`：调用方刚在本次发送里重启过这个运行时（PA-LATENCY-01），旧的「总是允许」已经清掉，不再重启第二次 */
export async function ensureTaskPermissions(c: Conv, restarted = false) {
  const plan = permissionPlan(c);
  if (!plan) return;
  const { policy, mode } = plan;
  // 刚重启过：运行时已就绪且没有旧许可，直接设置模式
  if (!restarted) {
    // Old runtimes may remember "always allow". Recreate once before applying restrictive settings.
    if (mode !== 'yolo' && applied.get(c.id) !== policy) await resetApprovals(c.id);
    // Creating a conversation does not start its agent. Ensure also restores an
    // unloaded runtime without restarting an existing one or clearing approvals.
    else await api('POST', `/api/conversations/${c.id}/runtime/ensure`, {});
  }
  await api('PUT', `/api/conversations/${c.id}/config-options/mode`, { value: mode });
  applied.set(c.id, policy);
}
export async function savePreference(name: string, value: string | number | boolean) {
  if (name === 'lang' && !['简体中文', 'English'].includes(String(value))) throw new Error('不支持的界面语言');
  if (name === 'supervise' && ![0, 1, 5, 10, 30, 60, 120].includes(Number(value))) throw new Error('无效的检查间隔');
  if (pending.has(name)) throw new Error('正在保存这个设置，请稍候');
  pending.add(name);
  try {
    if (name === 'launchAtLogin') {
      if (!isTauri()) throw new Error('请在 Lom 桌面应用中设置开机启动');
      const actual = await invoke<boolean>('login_start_set', { enabled: !!value });
      if (actual !== value) throw new Error('系统没有保存开机启动设置');
    }
    if (name === 'allowInstall') {
      if (!['ask', 'allow', 'deny'].includes(String(value))) throw new Error('无效权限');
      // REFACTOR-01 模块 4：只有受这项设置影响的任务在运行时才拒绝；手机、外部 Agent、个人助理、侧边聊天不受影响
      if (installBlockers().length) throw new Error('请先停止正在执行的任务，再调整命令权限');
      // Saved only after existing desktop runtimes acknowledge the policy. Every send reapplies it too.
      for (const t of S.teams) if (t.core) await api('POST', `/api/teams/${t.core.id}/session-mode`, { mode: effectiveMode(S.permission, String(value)) });
      for (const c of installAffected(String(value))) {
        const plan = permissionPlan(c, String(value))!;
        await resetApprovals(c.id);
        await api('PUT', `/api/conversations/${c.id}/config-options/mode`, { value: plan.mode });
        applied.set(c.id, plan.policy);
      }
    }
    update(s => { s.prefs[name] = value; });
    if (name === 'lang') document.documentElement.lang = value === 'English' ? 'en' : value === '繁體中文' ? 'zh-Hant' : 'zh-Hans';
  } finally { pending.delete(name); }
}

/** Passed on each turn, including existing conversations; explicit user content remains separate. */
export function publicationPolicy(c?: Conv) {
  if (c && nativeFullAccess(c)) return '[LOM_SETTINGS_V1]\n【Lom 用户设置】用户已为自带 Harness 开启完全访问：在当前请求和已接入能力范围内直接执行，不再逐项请求 Lom 操作确认；系统权限、第三方授权和登录仍由对应服务决定。\n[/LOM_SETTINGS_V1]';
  if (c && personalFullAccess(c)) return '[LOM_SETTINGS_V1]\n【Lom 用户设置】用户已为此个人助理开启完全访问：在当前请求和已接入能力范围内直接执行，不再逐项请求 Lom 操作确认；系统权限、第三方授权和登录仍由对应服务决定。\n[/LOM_SETTINGS_V1]';
  const rule = S.prefs.confirmPublish
    ? '【Lom 用户设置】对外发布（笔记、评论、私信、邮件）前，先展示目标和完整内容，停止执行并等待用户本次确认。只可准备草稿，不能把“全自动”视为发布确认。'
    : '【Lom 用户设置】仅执行用户已授权范围内的对外操作；未授权的付款、发布或发送仍须询问。';
  return `[LOM_SETTINGS_V1]\n${rule}\n[/LOM_SETTINGS_V1]`;
}

export function stripSettingsContext(text: string) {
  /* 顺序必须和发送时拼接的顺序一致（tasks.ts send）：设置 → 团队名单 → 目标 → 侧边聊天 → 历史前缀 → 个人助理身份 → 记忆 → 渠道来源 → 正文，
   * 正文可能就是目标自动推进块，所以历史前缀要在它之前剥掉，否则隐藏的推进消息会漏成用户消息。 */
  return text.replace(/^\[LOM_SETTINGS_V1\]\n【Lom 用户设置】[^\n]*\n\[\/LOM_SETTINGS_V1\]\n\n/, '')
    .replace(/^\[LOM_TEAM_V1\]\n[\s\S]*?\n\[\/LOM_TEAM_V1\]\n\n/, '') // OPC 团队名单（core/team.ts rosterContext）
    .replace(/^\[LOM_GOAL_V1\]\n[\s\S]*?\n\[\/LOM_GOAL_V1\]\n\n/, '') // 任务目标（core/commands.ts goalContext）
    .replace(/^\[LOM_SIDE_CONTEXT_V1\]\n[\s\S]*?\n\[\/LOM_SIDE_CONTEXT_V1\]\n\n/, '') // 侧边聊天每轮的只读快照（core/sideChat.ts）
    .replace(/^\[LOM_HISTORY_CONTEXT_V1\]\n[\s\S]*?\n\[\/LOM_HISTORY_CONTEXT_V1\]\n\n/, '') // 历史续聊的首轮前缀（tasks.ts HISTORY_PREAMBLE）
    .replace(/^\[LOM_PERSONAL_IDENTITY_V1\]\n[\s\S]*?\n\[\/LOM_PERSONAL_IDENTITY_V1\]\n\n/, '') // Personal 产品身份与工具查找规则
    .replace(/^\[LOM_PERSONAL_MEMORY_V1\]\n[\s\S]*?\n\[\/LOM_PERSONAL_MEMORY_V1\]\n\n/, '') // PA03 版本化记忆，文档正文按 JSON 转义
    .replace(/^\[LOM_CHANNEL_V1\]\n[\s\S]*?\n\[\/LOM_CHANNEL_V1\]\n\n/, '') // FEISHU-02 飞书 / 微信来源（chat/runtime/channelSource.ts）
    .replace(/^\[LOM_GOAL_CONTINUE\][\s\S]*?\[\/LOM_GOAL_CONTINUE\]\s*$/, ''); // 目标自动推进（core/tasks.ts GOAL_CONTINUE）
}
