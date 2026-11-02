import { invoke } from '@tauri-apps/api/core';
import { S } from '@/state/store';
import { loadAssistants } from './catalog';
import { feishuStatus, type FeishuStatus } from './feishu';
const key = (account: string) => `lom.personal.feishu-binding.v1:${account}`;
const registryKey = (account: string) => `lom.personal.feishu-binding.v2:${account}`;
interface Binding { appId: string; assistantId: string }
function check(account: string) {
  if (S.cloud !== 'signed-in' || S.account?.id !== account) throw new Error('feishu.account_changed');
}
function legacy(account: string): Binding | undefined {
  check(account);
  try {
    const value = JSON.parse(localStorage.getItem(key(account)) || 'null') as Binding | null;
    if (value && typeof value.appId === 'string' && value.appId && typeof value.assistantId === 'string' && value.assistantId) return value;
  } catch { console.warn('feishu.binding_invalid', 'stored binding is not JSON'); }
}
function bindings(account: string): Binding[] {
  check(account);
  try {
    const value: unknown = JSON.parse(localStorage.getItem(registryKey(account)) || '[]');
    return Array.isArray(value) ? value.filter((v): v is Binding => !!v && typeof v.appId === 'string' && typeof v.assistantId === 'string') : [];
  } catch { console.warn('feishu.binding_invalid', 'stored registry is not JSON'); return []; }
}
/** Recovery ownership survives deletion; it is never silently transferred. */
export function feishuAssistant(account: string, appId: string) {
  const binding = bindings(account).find(b => b.appId === appId) || legacy(account);
  return binding?.appId === appId ? loadAssistants(account).items.find(a => a.id === binding.assistantId) : undefined;
}
export function bindFeishuAssistant(account: string, appId: string, assistantId: string) {
  const all = bindings(account), old = legacy(account);
  if (!appId || !loadAssistants(account).items.some(a => a.id === assistantId)) throw new Error('feishu.binding_invalid');
  if ([...all, ...(old ? [old] : [])].some(b => b.appId === appId && b.assistantId !== assistantId)) throw new Error('feishu.binding_owned');
  localStorage.setItem(registryKey(account), JSON.stringify([...all.filter(b => b.assistantId !== assistantId), { appId, assistantId }]));
}
/** Probe legacy read-only, then migrate only an explicit or unique owner after app verification. */
export async function scopedFeishuStatus(account: string, assistantId: string): Promise<FeishuStatus> {
  const status = await feishuStatus(account, assistantId); check(account);
  if (status.configured) { if (status.app_id) bindFeishuAssistant(account, status.app_id, assistantId); return status; }
  const old = await feishuStatus(account); check(account);
  if (!old.configured || !old.app_id) return status;
  const stored = legacy(account), items = loadAssistants(account).items;
  const owner = stored?.appId === old.app_id ? stored.assistantId : !stored && items.length === 1 ? items[0].id : undefined;
  if (owner !== assistantId) return !stored && !owner ? { ...status, legacy_app_id: old.app_id } : status;
  const migrated = await invoke<FeishuStatus>('feishu_migrate_legacy', { account, assistantId, appId: old.app_id }); check(account);
  if (!migrated.configured || migrated.app_id !== old.app_id) throw new Error('feishu.migration_failed');
  bindFeishuAssistant(account, old.app_id, assistantId);
  return migrated;
}
export function unbindFeishuAssistant(account: string, _assistantId: string) { check(account); /* Retain exclusive recovery ownership. */ }

export async function claimLegacyFeishu(account: string, assistantId: string, appId: string) {
  check(account);
  const existing = legacy(account);
  if (existing && (existing.assistantId !== assistantId || existing.appId !== appId)) throw new Error('feishu.binding_owned');
  const migrated = await invoke<FeishuStatus>('feishu_migrate_legacy', { account, assistantId, appId }); check(account);
  if (!migrated.configured || migrated.app_id !== appId) throw new Error('feishu.migration_failed');
  bindFeishuAssistant(account, appId, assistantId); return migrated;
}
