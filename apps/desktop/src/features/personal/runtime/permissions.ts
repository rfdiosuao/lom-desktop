import { api } from '@/core/client';
import { authAccount, onAuthChange } from '@/features/account/runtime/authScope';
import { S, update, watchStore } from '@/state/store';
import { toast, toastError } from '@/shared/overlays/controller';
import { accountId, loadAssistants, storeAssistant, type PersonalAssistant } from './catalog';
import type { Conv } from '@/state/types';
export type PermissionTier = 'ask' | 'routine' | 'full';
export const permissionTier = (a: PersonalAssistant): PermissionTier => a.permission === undefined ? 'routine' : ['ask', 'routine', 'full'].includes(a.permission) ? a.permission : 'ask';
export const permissionLabels: Record<PermissionTier, string> = { ask: '每次询问', routine: '常用操作自动', full: '完全访问' };
const deferred = new Map<string, () => void>();
const applying = new Set<string>();
function owned(a: PersonalAssistant) {
  const owner = accountId(), saved = loadAssistants(owner).items.find(x => x.id === a.id && x.directory === a.directory && x.conversation === a.conversation);
  if (!saved) throw new Error('账号没有这位助理或会话归属已变化');
  return { owner, saved };
}
/** Explicit full access maps to yolo; other tiers retain the confirmation boundary. */
export async function applyPersonalPermission(a: PersonalAssistant) {
  const { owner, saved } = owned(a), current = authAccount();
  if (saved.conversation && S.running[saved.conversation]) { schedule(saved, owner); return; }
  const id = `${owner}:${saved.id}`;
  if (applying.has(id)) throw new Error('personal.permission_apply_failed: 权限正在更新，请稍后重试');
  applying.add(id);
  const target = saved.permissionPending ?? permissionTier(saved);
  try {
    if (saved.conversation && saved.permissionPending) {
      const info = await api<{ runtime?: { has_task?: boolean; is_processing?: boolean } }>('GET', `/api/conversations/${saved.conversation}`);
      if (!current()) throw new Error('账号已切换');
      if (info.runtime?.is_processing || S.running[saved.conversation]) { schedule(saved, owner); return; }
      if (typeof info.runtime?.has_task !== 'boolean') throw new Error('核心未确认运行时状态');
      await api('POST', `/api/conversations/${saved.conversation}/runtime/${info.runtime.has_task ? 'restart' : 'ensure'}`, {});
      if (!current()) throw new Error('账号已切换');
    } else if (saved.conversation) {
      await api('POST', `/api/conversations/${saved.conversation}/runtime/ensure`, {});
      if (!current()) throw new Error('账号已切换');
    }
    if (saved.conversation) await api('PUT', `/api/conversations/${saved.conversation}/config-options/mode`, { value: target === 'full' ? 'yolo' : 'default' });
    if (!current()) throw new Error('账号已切换，权限更新结果未应用到本机配置');
    const latest = owned(saved).saved;
    latest.permission = target; delete latest.permissionPending; delete latest.permissionError;
    const migrated = !latest.permissionMigrated && a.permission === undefined;
    latest.permissionMigrated = true; storeAssistant(latest, owner); Object.assign(a, latest);
    delete a.permissionPending; delete a.permissionError;
    if (migrated) toast('已改为常用操作自动，可在助理设置里调整', 'shield');
    update();
  } catch (e) {
    if (!current()) throw new Error('账号已切换，权限更新结果未应用到本机配置');
    const latest = owned(saved).saved;
    delete latest.permissionPending; latest.permissionError = 'personal.permission_apply_failed：核心未确认权限更新，保留原档位';
    storeAssistant(latest, owner); update();
    throw new Error(latest.permissionError, { cause: e });
  } finally { applying.delete(id); }
}
function schedule(a: PersonalAssistant, owner: string) {
  const current = authAccount(), id = `${owner}:${a.id}`;
  deferred.set(id, () => {
    if (!current()) { deferred.delete(id); return; }
    if (a.conversation && S.running[a.conversation]) return;
    deferred.delete(id);
    void applyPersonalPermission(a).catch(e => toastError('权限档位更新失败', e));
  });
}
watchStore(() => { for (const run of [...deferred.values()]) run(); });
onAuthChange(() => { deferred.clear(); });
export async function requestPermissionTier(a: PersonalAssistant, tier: PermissionTier) {
  if (!['ask', 'routine', 'full'].includes(tier)) throw new Error('无效权限档位');
  const { owner, saved } = owned(a);
  if (applying.has(`${owner}:${saved.id}`)) throw new Error('权限正在更新，请稍后重试');
  saved.permissionPending = tier; storeAssistant(saved, owner);
  if (saved.conversation && S.running[saved.conversation]) { schedule(saved, owner); update(); return; }
  await applyPersonalPermission(saved);
}
/** Resolve the persisted account-scoped profile, never agent text or caller fields. */
export function personalPermissionAssistant(c: Conv) {
  if (!c.personal || c.sideOf || S.cloud !== 'signed-in' || !S.account || !S.convs.includes(c)) return;
  try { return loadAssistants().items.find(a => a.id === c.personal!.id && a.conversation === c.id && a.directory === c.personal!.directory); }
  catch (e) { console.warn('personal.permission_config_unavailable', e instanceof Error ? e.name : 'unknown'); return; }
}
export function personalAutoAllow(c: Conv, engine: string, commandType: unknown): boolean {
  if (engine !== 'embedded') return false;
  if (personalFullAccess(c)) return true;
  if (S.prefs.allowInstall === 'deny') return false;
  const a = personalPermissionAssistant(c);
  return !!a && permissionTier(a) === 'routine' && commandType === 'info';
}
export function requiresApproval(a: PersonalAssistant): boolean {
  try { const tier = permissionTier(owned(a).saved); return tier === 'ask' || (tier !== 'full' && S.prefs.allowInstall === 'deny'); }
  catch { return true; } // Unowned profiles never receive automatic authorization.
}

export function personalFullAccess(c: Conv): boolean {
  const a = personalPermissionAssistant(c); return !!a && permissionTier(a) === 'full';
}
export const personalCoreMode = (c: Conv) => personalFullAccess(c) ? 'yolo' : 'default';

export function personalPermissionLabel(c?: Conv): string {
  const a = c && personalPermissionAssistant(c); return permissionLabels[a ? permissionTier(a) : 'ask'];
}
