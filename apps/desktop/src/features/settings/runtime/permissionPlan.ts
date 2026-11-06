import { personalCoreMode } from '@/features/personal/runtime/permissions';
import { S } from '@/state/store';
import { coreTeamOf, perm } from '@/state/selectors';
import type { Conv } from '@/state/types';

/* ===== REFACTOR-01 模块 4（#280）：每个会话的权限应用计划 =====
 * 同一套「用户请求的权限 → 核心实际生效的模式」原来在 ensureTaskPermissions 和保存「命令与安装」设置时各算一遍，
 * 保存设置时还会重启个人助理、侧边聊天这类不受它影响的会话，并在任何任务运行时（包括手机和外部 Agent）拒绝保存。
 * 现在每个会话只按这里算一次：哪个策略、核心模式是什么、是否受「命令与安装」影响。外部 Agent 由它自己的适配处理。 */

export type CoreMode = 'default' | 'auto_edit' | 'yolo';
export interface PermissionPlan {
  /** 策略标识：变化时需要清掉旧的「总是允许」后再应用 */
  policy: string;
  mode: CoreMode;
  /** 是否受全局「命令与安装」设置影响 */
  followsInstall: boolean;
}

/** 「命令与安装」三档的名称。核心只有 逐项确认 / 自动编辑 / 全自动 三种模式，没有「直接拒绝」，
 *  所以 deny 档（为兼容已保存的设置，标识不变）只能做到「命令和写入都逐项确认」，名称不得宣称「禁止」（SET-PERM-01 #424） */
export const INSTALL_POLICY_LABELS: Record<string, string> = { ask: '始终询问', allow: '跟随任务权限', deny: '命令和写入逐项确认' };
export const INSTALL_POLICY_DESC = '适用于内置总指挥的普通会话；完全访问会覆盖此设置。「始终询问」让全自动档位也先确认命令；「命令和写入逐项确认」连自动编辑文件也逐项确认。核心目前没有「直接拒绝」模式，这两档都不会自动拒绝操作，要拒绝请在确认框里选择。定时任务与外部 CLI 使用各自权限。';

/** Installation restrictions also cover arbitrary commands; parsing shell text is not a security boundary. */
export function effectiveMode(permission: string, install = S.prefs.allowInstall): CoreMode {
  if (permission === 'full') return 'yolo';
  const chosen = perm(permission).coreMode as CoreMode;
  if (permission === 'readonly' || install === 'deny') return 'default';
  return install === 'ask' && chosen === 'yolo' ? 'default' : chosen;
}

/** 这个会话应当应用的权限；外部 Agent（自带 Harness）返回 undefined，由它的选项适配处理 */
export function permissionPlan(c: Conv, install = S.prefs.allowInstall, permission = S.permission): PermissionPlan | undefined {
  if (c.agentId) return undefined;
  if (c.sideOf) return { policy: 'side:readonly', mode: 'default', followsInstall: false };
  if (c.personal) { const mode = personalCoreMode(c); return { policy: `personal:${mode}`, mode, followsInstall: false }; }
  return { policy: `${install}:${permission}`, mode: effectiveMode(permission, install), followsInstall: true };
}

/** 改「命令与安装」需要重新应用的电脑会话：只看受它影响的，核心团队的成员会话由团队接口统一处理 */
export const installAffected = (install: string) =>
  S.convs.filter(c => c.remote && !coreTeamOf(c.id) && permissionPlan(c, install)?.followsInstall);

/** 正在运行、会被这次设置改动影响的任务；不认识的运行记录无法证明不受影响，一律算作受影响 */
export function installBlockers(): string[] {
  return Object.entries(S.running).filter(([, on]) => on).map(([id]) => id).filter(id => {
    const c = S.convs.find(x => x.id === id);
    if (!c) return true;
    if (coreTeamOf(id)) return true;
    return !!c.remote && !!permissionPlan(c)?.followsInstall;
  });
}

/** 电脑任务权限按钮：所选档位与核心实际生效不一致时说明原因（例如「全自动」但命令仍需确认） */
export function desktopPermissionLabel(permission = S.permission, install = S.prefs.allowInstall): { name: string; note?: string } {
  const chosen = perm(permission), actual = effectiveMode(permission, install);
  if (actual === chosen.coreMode) return { name: chosen.name };
  return { name: chosen.name, note: install === 'deny' ? '「命令与安装」设为逐项确认，命令和写入都需确认' : '「命令与安装」设为询问，执行命令前仍需确认' };
}
