import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { update } from '@/state/store';

/* ===== FEISHU-01：飞书扫码接入（桌面外壳调内置的飞书官方 lark-cli）=====
 * 扫一次码：飞书自动在你的账号下创建“个人智能体”机器人，并记下你是主人（FEISHU-06）；
 * 可选再授权：让助理以你的身份使用文档、表格、日历、任务等。
 * 凭据只在本机钥匙串里，每位个人助理各自独立。 */

export interface FeishuStatus { legacy_app_id?: string; generation: number; configured: boolean; app_id?: string | null; authorized: boolean; connected?: boolean; auth?: FeishuAuthProgress | null }
export interface FeishuAuthProgress { account: string; assistant_id: string; app_id?: string; generation: number; pending: boolean; prompt?: FeishuPrompt | null; error?: string | null; warning?: string | null }
export interface FeishuPrompt { generation?: number; url: string; qr: string }
export interface FeishuStep { stage: 'app' | 'auth'; account: string; assistant_id: string; app_id?: string; generation: number; ok: boolean; error?: string | null; warning?: string | null }

export interface FeishuScope { account: string; assistantId: string; appId: string; generation: number }
export interface FeishuEventScope { account: string; assistant_id: string; app_id?: string; generation: number }
export const sameFeishuScope = (scope: FeishuScope, event: FeishuEventScope) => scope.account === event.account && scope.assistantId === event.assistant_id && scope.appId === event.app_id && scope.generation === event.generation;
const revisions = new Map<string, number>();
const generations = new Map<string, number>();
const scopeKey = (account: string, assistantId: string) => JSON.stringify([account, assistantId]);
export function invalidateFeishuScope(account: string, assistantId: string) {
  const key = scopeKey(account, assistantId); revisions.set(key, (revisions.get(key) || 0) + 1);
  update(() => {});
}
export function captureFeishuScope(scope: FeishuScope) {
  const key = scopeKey(scope.account, scope.assistantId), revision = revisions.get(key) || 0;
  return () => Number.isSafeInteger(scope.generation) && scope.generation >= 0 && (revisions.get(key) || 0) === revision && generations.get(key) === scope.generation;
}
export function recordFeishuScope(scope: FeishuScope) {
  if (!Number.isSafeInteger(scope.generation) || scope.generation < 0) return;
  const key = scopeKey(scope.account, scope.assistantId);
  generations.set(key, Math.max(generations.get(key) ?? 0, scope.generation));
}
export async function feishuStatus(account: string, assistantId?: string) {
  const status = await invoke<FeishuStatus>('feishu_status', { account, ...(assistantId ? { assistantId } : {}) });
  if (assistantId) recordFeishuScope({account,assistantId,appId:status.app_id || '',generation:status.generation});
  return status;
}
export const beginFeishuApp = (account: string, assistantId: string) => invoke<FeishuPrompt>('feishu_connect_begin', { account, assistantId });
export const beginFeishuAuth = (account: string, assistantId: string) => invoke<FeishuPrompt>('feishu_authorize_begin', { account, assistantId });
export const cancelFeishu = (account: string, assistantId: string) => invoke<void>('feishu_cancel', { account, assistantId });
export const revokeFeishuAuth = (account: string, assistantId: string) => invoke<void>('feishu_auth_revoke', { account, assistantId });
export const disconnectFeishu = (account: string, assistantId: string) => { invalidateFeishuScope(account, assistantId); return invoke<void>('feishu_disconnect', { account, assistantId }); };
export const onFeishuStep = (fn: (step: FeishuStep) => void) => listen<FeishuStep>('feishu-connect', e => fn(e.payload));

/** 把外壳和 lark-cli 的错误换成用户看得懂的话；敏感的组件输出不进入控制台 */
export function feishuError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');

  if (raw.includes('auth_not_saved')) return '飞书已同意但本机未保存，请重试授权';
  if (raw.includes('auth_status_failed')) return '无法确认授权结果，请重试授权';
  if (raw.includes('auth_card_failed')) return '飞书消息发送失败，请扫码';
  if (raw.includes('auth_starting')) return '正在准备授权，请稍候';
  if (raw.includes('owner_missing')) return '未找到机器人主人，请先连接飞书';
  if (raw.includes('binary_not_found')) return '这个安装包里缺少飞书组件，请更新 Lom 后重试';
  if (raw.includes('no_qr')) return '没有拿到扫码二维码，请检查网络后重试';
  if (/access_denied|denied|拒绝/i.test(raw)) return '你在飞书里拒绝了这次请求，可以重新扫码';
  if (/expired|timed? ?out|过期|超时/i.test(raw)) return '二维码已过期，请重新扫码';
  if (raw.includes('account_invalid')) return '请先登录 Lom 账号';
  return '连接飞书没有成功，请重试';
}
