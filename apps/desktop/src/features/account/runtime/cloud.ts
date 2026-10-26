import { loadPhoneCache } from '@/features/phones/runtime/phoneCache';
import { syncDeviceAccount } from '@/features/phones/runtime/accountDeviceConfig';
import { invoke } from '@tauri-apps/api/core';
import { toast, toastError } from '@/shared/overlays/controller';
import { S, update } from '@/state/store';
import { api } from '@/core/client';
import type { CoreProvider } from '@/core/types';
import { inShell } from '@/core/platform';
import { refreshProviders } from '@/features/settings/runtime/providerSync';
import { loadPlans, type PlanInfo } from './plans';
import { authAccount, authRevision, beginAuthChange, type AuthGuard } from './authScope';
import { syncSearchSession } from './searchSession';
import { mergedLegacy, reconcileSelections } from './modelReconcile';
import { syncScheduleModels } from './scheduleModelSync';
import type { LegacyModels } from './modelBinding';

/* ===== Lom 云端（S04-01）：HEANG 账号登录、积分、兑换码 =====
 * 登录在桌面外壳里完成（系统浏览器 + PKCE），会话令牌存系统钥匙串；
 * 积分令牌写进 lom-core 的「Lom 云端」模型服务，界面上显示为 Lom Pro / Max / Mini。 */

import { LOM_CLOUD_URL, cloudConfigured, requireCloudService } from './serviceConfig';
export { LOM_CLOUD_URL } from './serviceConfig';
export { LOM_PROVIDER_NAME } from './builtin';
import { LOM_PROVIDER_NAME } from './builtin';

export class CloudError extends Error {
  constructor(public code: string, message: string, public status?: number) {
    super(message);
    this.name = 'CloudError';
  }
}

export interface CloudModels { pro: string; max: string; mini: string; }
/** extra：订阅里 Lom 三档之外、后台直接勾选的星钥模型（lom-server routes.rs gateway_json） */
interface Gateway { revision?: number; legacy?: LegacyModels; allowed_tiers?: (keyof CloudModels)[]; base_url: string | null; key: string | null; models: CloudModels; vision?: (keyof CloudModels)[]; extra?: string[] }
interface SessionData { session?: string; account: { id: string; email: string; name: string; avatar?: string; provider_avatar?: string }; points: { total: number; free: number; paid: number; period: string; daily?: number }; gateway: Gateway; }

let session: string | null = null;

/** 访问麓鸣云端（带账户会话）；配对与设备接口也经由这里（core/devices.ts） */
export async function cloud<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  requireCloudService();
  let res: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    res = await fetch(LOM_CLOUD_URL + path, {
      method, signal: controller.signal,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(session ? { authorization: `Bearer ${session}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new CloudError('cloud.unreachable', `无法连接麓鸣服务（${e instanceof Error ? e.message : String(e)}）`);
  }
  finally { clearTimeout(timeout); }
  let json: { success?: boolean; data?: T; code?: string; error?: string } = {};
  try { json = await res.json(); } catch { throw new CloudError('cloud.bad_response', `麓鸣服务返回了无法解析的内容（HTTP ${res.status}）`, res.status); }
  if (!res.ok || json.success === false) throw new CloudError(json.code || `HTTP_${res.status}`, json.error || `请求失败（HTTP ${res.status}）`, res.status);
  return json.data as T;
}

/** 只有服务端明确说会话失效时才清除本地登录（S01-01 §2.7） */
const sessionGone = (e: unknown) => e instanceof CloudError && ['auth.session_expired', 'auth.session_revoked', 'auth.session_missing'].includes(e.code);

/** 把积分令牌写进 lom-core 的「Lom 云端」模型服务（已有就更新） */
let providerSync = Promise.resolve();
let credentialSync = Promise.resolve();
function enqueueProvider(work: () => Promise<void>) {
  const next = providerSync.then(work);
  providerSync = next.catch(() => { /* Caller reports the error; keep subsequent cleanup writable. */ });
  return next;
}

function writeCredential(command: 'session_set' | 'session_clear', isCurrent: AuthGuard, token?: string) {
  const next = credentialSync.then(async () => {
    // A later login may fail: mandatory clear stays ordered before any newer credential write.
    if (command === 'session_set' && !isCurrent()) return;
    if (token) await invoke(command, { token }); else await invoke(command);
  });
  credentialSync = next.catch(() => { /* Caller reports storage failure; later logout must still clear it. */ });
  return next;
}

async function writeLomProvider(gw: Gateway, isCurrent: AuthGuard) {
  if (!isCurrent()) return;
  if (!gw.base_url || !gw.key) { await disableLomProvider(isCurrent); return; }
  if (gw.revision !== undefined && gw.revision < S.cloudModelRevision) throw new Error('模型配置版本过旧，请重新同步');
  const previous = S.cloudModels;
  const legacy = mergedLegacy(gw.legacy, previous);
  const tiers = [gw.models.pro, gw.models.max, gw.models.mini];
  const extra = (gw.extra ?? []).filter(m => !tiers.includes(m));
  const models = [...tiers, ...extra];
  // 服务端实测过能看图的档位打开视觉输入，其余明确关闭：看不到图的模型会改用看图工具（core/vision.ts）
  const vision = gw.vision ?? [];
  const model_settings = Object.fromEntries((['pro', 'max', 'mini'] as const).map(k => [gw.models[k], { image_input: vision.includes(k) ? 'supported' : 'unsupported' }]));
  await refreshProviders(isCurrent);
  if (!isCurrent()) return;
  const existing = S.providers.find(p => p.name === LOM_PROVIDER_NAME);
  if (existing) {
    await api('PUT', `/api/providers/${existing.id}`, { base_url: gw.base_url, api_key: gw.key, models, model_settings, enabled: true });
  } else {
    await api('POST', '/api/providers', { platform: 'openai', name: LOM_PROVIDER_NAME, base_url: gw.base_url, api_key: gw.key, models, model_settings, enabled: true });
  }
  if (!isCurrent()) return;
  await refreshProviders(isCurrent);
  if (!isCurrent()) return;
  const p = S.providers.find(x => x.name === LOM_PROVIDER_NAME);
  if (!p?.enabled || p.base_url !== gw.base_url || models.some(m => !p.models.includes(m))) throw new Error('核心没有确认新的模型服务配置，请重新同步');
  update(s => {
    s.cloudModels = gw.models;
    s.cloudModelRevision = gw.revision ?? 0;
    s.cloudVision = gw.vision ?? [];
    s.cloudAllowed = gw.allowed_tiers ?? null;
    s.cloudExtra = extra;
    /* 仅首次未选择时默认 Lom Pro；自带 Key 失效时不能静默切回积分模型 */
    if (p && !s.model) s.model = 'lom-pro';
  });
  if (p) {
    reconcileSelections(p.id, gw.models, legacy);
    const revision = S.cloudModelRevision;
    syncScheduleModels(p.id, gw.models, legacy, () => isCurrent() && S.cloudModelRevision === revision);
  }
}

async function apply(d: SessionData, isCurrent: AuthGuard) {
  if (!isCurrent()) return;
  if (!d.account?.id) throw new Error('登录服务没有返回有效账号，请重试');
  update(s => {
    if (s.account?.id !== d.account.id) {
      s.plans = null; s.subscription = null; s.plansError = '';
      s.cloudModels = null; s.cloudVision = []; s.cloudExtra = []; s.cloudLegacy = {}; s.cloudModelRevision = -1; s.cloudAllowed = null; s.cloudScheduleError = '';
      const p = s.providers.find(x => x.name === LOM_PROVIDER_NAME);
      if (p) { p.enabled = false; if (s.model.startsWith(`${p.id}::`)) s.model = ''; }
    }
    s.account = d.account; s.points = d.points; s.cloud = 'signed-in'; s.cloudError = '';
  });
  syncDeviceAccount();
  loadPhoneCache();
  if (S.conn === 'ready') void syncSearchSession(session, isCurrent);
  try {
    if (S.conn === 'ready') await enqueueProvider(() => writeLomProvider(d.gateway, isCurrent));
  } catch (e) {
    if (isCurrent()) toastError('写入 Lom 云端模型失败', e);
  }
}

/** 启动时恢复登录：钥匙串里有会话就向服务端确认 */
let restoring: Promise<void> | null = null;
export function restoreSession(): Promise<void> {
  if (restoring) return restoring;
  restoring = restore().finally(() => { restoring = null; });
  return restoring;
}
async function restore() {
  if (!cloudConfigured()) { session = null; update(s => { s.cloud = 'signed-out'; s.account = null; s.points = null; s.cloudError = ''; }); return; }
  const isCurrent = beginAuthChange();
  update(s => { s.cloud = 'checking'; s.cloudError = ''; });
  if (!inShell()) { update(s => { s.cloud = 'signed-out'; }); return; }
  try {
    const saved = await invoke<string | null>('session_get');
    if (!isCurrent()) return;
    session = saved;
  }
  catch {
    if (!isCurrent()) return;
    session = null;
    update(s => { s.cloud = 'signed-out'; s.cloudError = '无法读取已保存的登录，请重新登录。'; });
    return;
  }
  if (!session) { await clearLocal(isCurrent, false); return; }
  try { await apply(await cloud<SessionData>('GET', '/v1/account/me'), isCurrent); }
  catch (e) {
    if (!isCurrent()) return;
    if (sessionGone(e)) { await clearLocal(beginAuthChange()); return; }
    // Keep the stored credential on network failure, but never unlock without validation.
    update(s => { s.cloud = 'unavailable'; s.cloudError = e instanceof Error ? e.message : String(e); });
  }
}

export type LoginMethod = 'login' | 'register' | 'google' | 'github';
export async function signIn(method: LoginMethod = 'login') {
  if (S.cloud === 'signing-in' || S.cloud === 'checking') return;
  if (!inShell()) { toast('浏览器开发模式不支持系统登录，请在桌面应用里登录', 'info'); return; }
  const isCurrent = beginAuthChange();
  update(s => { s.cloud = 'signing-in'; s.cloudError = ''; });
  try {
    const cfg = await cloud<{ issuer: string; client_id: string; scope: string }>('GET', '/v1/auth/config');
    if (!isCurrent()) return;
    const idToken = await invoke<string>('heang_login', { issuer: cfg.issuer, clientId: cfg.client_id, scope: cfg.scope, method });
    if (!isCurrent()) return;
    const d = await cloud<SessionData>('POST', '/v1/session', { id_token: idToken });
    if (!isCurrent()) return;
    session = d.session ?? null;
    if (!session) throw new Error('登录服务没有返回有效会话，请重试');
    try { await writeCredential('session_set', isCurrent, session); }
    catch { if (isCurrent()) toast('登录成功，但无法保存登录状态；下次打开需要重新登录', 'info'); }
    if (!isCurrent()) return;
    await apply(d, isCurrent);
    if (!isCurrent()) return;
    await loginFeedback(true);
    if (!isCurrent()) return;
    toast(`已登录：${d.account.name || d.account.email}，积分 ${d.points.total} 点`, 'check');
  } catch (e) {
    if (!isCurrent()) return;
    await loginFeedback(false);
    if (!isCurrent()) return;
    update(s => { s.cloud = 'signed-out'; s.cloudError = e instanceof Error ? e.message : String(e); });
    toastError('登录失败', e);
  }
}

async function loginFeedback(success: boolean) {
  try { await invoke('login_complete', { success }); }
  catch { console.warn('auth.feedback_failed: 浏览器回调页未能更新，请以应用内状态为准'); }
}

async function clearLocal(isCurrent: AuthGuard, removeCredential = true) {
  if (!isCurrent()) return;
  session = null;
  if (S.conn === 'ready') void syncSearchSession(null, isCurrent);
  const p = S.providers.find(x => x.name === LOM_PROVIDER_NAME);
  update(s => {
    s.account = null; s.points = null; s.cloud = 'signed-out'; s.cloudError = '';
    s.cloudModels = null; s.cloudVision = []; s.cloudExtra = []; s.cloudLegacy = {}; s.cloudModelRevision = -1; s.cloudAllowed = null; s.cloudScheduleError = '';
    s.plans = null; s.subscription = null; s.plansError = '';
    if (p) p.enabled = false;
    if (p && s.model.startsWith(`${p.id}::`)) s.model = '';
  });
  syncDeviceAccount();
  loadPhoneCache();
  const credential = removeCredential ? writeCredential('session_clear', isCurrent).catch(() => {
    if (isCurrent()) console.warn('auth.clear_failed: 无法清除已保存的登录，请在系统钥匙串中移除 Lom 会话');
  }) : Promise.resolve();
  await Promise.all([credential, enqueueProvider(() => disableLomProvider(isCurrent, true))]);
}

async function disableLomProvider(isCurrent: AuthGuard, mandatory = false) {
  if ((!mandatory && !isCurrent()) || S.conn !== 'ready') return;
  try {
    // Read without updating UI: a newer login may be waiting behind this required cleanup.
    const list = await api<CoreProvider[]>('GET', '/api/providers');
    if (!mandatory && !isCurrent()) return;
    const p = list.find(x => x.name === LOM_PROVIDER_NAME);
    if (!p) return;
    await api('PUT', `/api/providers/${p.id}`, { enabled: false, api_key: '' });
    if (isCurrent()) await refreshProviders(isCurrent);
  } catch { if (isCurrent()) console.warn('auth.provider_disable_failed: 核心未能停用云端模型，请恢复核心连接后重试退出'); }
}

/** Reconcile credentials on core startup/reconnect, without starting an interactive login. */
export async function syncCoreAccount() {
  if (S.cloud === 'signed-in') {
    if (session) await repairBuiltin();
    return;
  }
  const isCurrent = authRevision();
  if (S.conn === 'ready') void syncSearchSession(null, isCurrent);
  await enqueueProvider(() => disableLomProvider(isCurrent, true));
}

/** 退出：吊销服务端会话，清除本机令牌并停用内置模型（入口始终保留） */
export async function signOut() {
  const revocation = session ? cloud('DELETE', '/v1/session').catch(() => {
    console.warn('auth.revoke_failed: 服务端会话吊销失败，继续清理本机');
  }) : Promise.resolve();
  const isCurrent = beginAuthChange();
  await clearLocal(isCurrent);
  await revocation;
  if (isCurrent()) toast('已退出登录', 'logout');
}

export async function repairBuiltin() {
  if (!session) { await signIn(); return; }
  const isCurrent = authRevision();
  try { await apply(await cloud<SessionData>('GET', '/v1/account/me'), isCurrent); }
  catch (e) { if (!isCurrent()) return; if (sessionGone(e)) await clearLocal(beginAuthChange()); toastError('恢复内置模型失败', e); }
}

export async function refreshPoints() {
  if (!session) return;
  const isCurrent = authRevision();
  try {
    if (!S.providers.some(p => p.name === LOM_PROVIDER_NAME && p.enabled)) { await apply(await cloud<SessionData>('GET', '/v1/account/me'), isCurrent); return; }
    await ensureCloudConfig(true);
    if (!isCurrent()) return;
    const points = await cloud<SessionData['points']>('GET', '/v1/points');
    if (!isCurrent()) return;
    update(s => { s.points = points; s.cloudError = ''; });
  } catch (e) {
    if (!isCurrent()) return;
    if (sessionGone(e)) { await clearLocal(beginAuthChange()); return; }
    update(s => { s.cloudError = e instanceof Error ? e.message : String(e); });
  }
}

export async function redeemCode(code: string) {
  const isCurrent = authAccount();
  if (!session || !isCurrent()) throw new CloudError('auth.session_missing', '请先登录');
  const d = await cloud<{ points: SessionData['points']; added: number; credited: boolean; plan: PlanInfo | null }>('POST', '/v1/points/redeem', { code });
  if (!isCurrent()) throw new CloudError('auth.session_changed', '账号已切换，请重新查看积分');
  update(s => { s.points = d.points; });
  // 订阅兑换码会改变档位；重新读取一次，账号页和模型权限马上跟上
  if (d.plan) await loadPlans();
  if (!isCurrent()) throw new CloudError('auth.session_changed', '账号已切换，请重新查看积分');
  return d;
}

let modelRefresh: Promise<void> | null = null, refreshAccount = '', lastModelCheck = 0;
let refreshCurrent: AuthGuard = () => false;
/** Coalesce account-scoped refreshes. Never retry a message to repair configuration. */
export async function ensureCloudConfig(force = false) {
  if (!session || S.cloud !== 'signed-in' || S.conn !== 'ready') return;
  const owner = S.account?.id || '';
  if (modelRefresh && refreshCurrent() && refreshAccount === owner) return modelRefresh;
  if (!force && refreshAccount === owner && !S.cloudError && Date.now() - lastModelCheck < 3000) return;
  const isCurrent = authAccount(); refreshAccount = owner; refreshCurrent = isCurrent;
  const work = (async () => {
    let gw: Gateway;
    try { gw = await cloud<Gateway>('GET', '/v1/model-config'); }
    catch (e) {
      if (!(e instanceof CloudError) || e.status !== 404) throw e;
      gw = (await cloud<SessionData>('GET', '/v1/account/me')).gateway;
    }
    if (!isCurrent()) throw new Error('账号已切换，未应用旧模型配置');
    await enqueueProvider(() => writeLomProvider(gw, isCurrent));
    if (!isCurrent()) throw new Error('账号已切换，未发送消息');
    lastModelCheck = Date.now();
    update(s => { s.cloudError = ''; });
  })();
  modelRefresh = work;
  try { await work; }
  catch (e) { if (isCurrent()) { lastModelCheck = 0; update(s => { s.cloudError = `模型同步失败：${e instanceof Error ? e.message : String(e)}`; }); } throw e; }
  finally { if (modelRefresh === work) modelRefresh = null; }
}

export async function ensureLomSelection(id?: string) {
  const p = S.providers.find(x => x.name === LOM_PROVIDER_NAME);
  if (!id || /^lom-(pro|max|mini)$/.test(id) || (p && id.startsWith(`${p.id}::`))) await ensureCloudConfig();
}

let pointsTimerStarted = false;
/** Points retain their cadence; model refresh is bounded and also runs on focus. */
export function startPointsTimer() {
  if (pointsTimerStarted) return;
  pointsTimerStarted = true;
  const check = () => { if (document.visibilityState !== 'hidden') void ensureCloudConfig(true).catch(() => { /* cloudError exposes the failure; sends remain gated. */ }); };
  window.setInterval(check, 60000); window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', check);
  window.setInterval(() => { void refreshPoints(); }, 30 * 60 * 1000);
}

export async function saveProfile(name: string, avatar: string | null) {
  const isCurrent = authAccount();
  if (!session || !isCurrent()) throw new CloudError('auth.session_missing', '请先登录');
  const a = await cloud<SessionData['account']>('PATCH', '/v1/account/me', { name, avatar });
  if (!isCurrent()) throw new CloudError('auth.session_changed', '账号已切换，请重新查看个人资料');
  update(s => { s.account = a; });
}

/** Authenticated bounded binary download; never put the session in a URL. */
export async function cloudSkillArchive(id: string, expectedSha?: string): Promise<{ bytes: Uint8Array; sha256: string }> {
  requireCloudService();
  const isCurrent = authAccount();
  const token = session, account = S.account?.id;
  if (!token || S.cloud !== 'signed-in') throw new Error('请先登录');
  const manifest = expectedSha ? {id,sha256:expectedSha} : (await cloud<{id:string;sha256:string}[]>('GET','/v1/skills')).find(x=>x.id===id);
  if(!manifest || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error('技能版本已变化，请刷新市场后重试');
  if(!isCurrent() || S.account?.id !== account || session !== token) throw new Error('账号已切换');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(`${LOM_CLOUD_URL}/v1/skills/${encodeURIComponent(id)}/download`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal, redirect: 'error' });
    if (!res.ok) throw new Error(`技能下载失败（HTTP ${res.status}）`);
    const sha256 = manifest.sha256;
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('技能包缺少完整性校验信息');
    const reader = res.body?.getReader(); if (!reader) throw new Error('技能包为空');
    const parts: Uint8Array[] = []; let size = 0;
    while (true) { const r = await reader.read(); if (r.done) break; size += r.value.length;
      if (size > 10*1024*1024) { await reader.cancel(); throw new Error('技能包超过 10 MB'); } parts.push(r.value); }
    if (!isCurrent() || S.account?.id !== account || session !== token) throw new Error('账号已切换，下载已取消');
    const bytes = new Uint8Array(size); let at=0; for (const part of parts) { bytes.set(part, at); at+=part.length; }
    return { bytes, sha256 };
  } finally { clearTimeout(timer); }
}
