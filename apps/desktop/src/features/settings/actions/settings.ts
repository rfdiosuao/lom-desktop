import { desktopUpdater } from '@/features/updates/runtime/updater';
import { openProjectLink } from '../runtime/projectLinks';
import { savePreference } from '../runtime/preferences';
import { addProvider, deleteProvider, listModels, PROVIDER_PRESETS, testProvider } from '../runtime/providers';
import { S, update } from '@/state/store';
import { initialState } from '@/state/state';
import type { Team } from '@/state/types';
import { redeemCode, signIn, signOut, saveProfile } from '@/features/account/runtime/cloud';
import { closeModal, confirm, openModal, toast, toastError } from '@/shared/overlays/controller';

import { PENDING_PREFERENCES, unavailable } from '@/shared/lib/unavailable';

/* 设置：未接入选项不能伪装成已生效。 */

export const togglePref = (key: string) => {
  if (PENDING_PREFERENCES[key]) { unavailable(PENDING_PREFERENCES[key]); return; }
  void savePreference(key, !S.prefs[key]).catch(e => toastError('设置未保存', e));
};
export const setPref = (name: string, value: string | number) => {
  if (PENDING_PREFERENCES[name]) { unavailable(PENDING_PREFERENCES[name]); return; }
  void savePreference(name, value).catch(e => toastError('设置未保存', e));
};
export const settingsPage = (page: string) => update(s => { s.settingsPage = page; });

export const shortcuts = () => openModal('shortcuts');
export const auditLog = () => openModal('audit');
export const feedback = () => openModal('feedback');
export const projectLink = (link: 'repository' | 'documentation') => {
  void openProjectLink(link).catch(e => toastError('无法打开链接', e));
};
export const editProfile = () => { S.form = { name: S.account?.name || '', avatar: S.account?.avatar || '', saving: false, error: '' }; openModal('profile'); };
export const toastClose = (text: string) => { closeModal(); toast(text); };
export const logout = () => confirm({ title: '退出登录？', desc: '退出后 Lom 云端模型不可用，本机的任务和自带 Key 不受影响；手机配对也不会解除。', okText: '退出', onOk: () => { void signOut(); } });

/* ---------- 积分充值（S04-01 §2.5）：第一版用兑换码，在线支付即将开放 ---------- */
export const recharge = () => {
  if (S.cloud !== 'signed-in') { toast('先登录 HEANG 账号，才能充值积分', 'person'); void signIn(); return; }
  S.form = { pack: 98, code: '', redeeming: false, error: '' };
  openModal('recharge');
};

/** 开通 / 续费某一档：在线支付接入前，用订阅兑换码开通（兑换码在充值弹窗里兑换） */
export function subscribe(tier: number) {
  const t = S.plans?.tiers.find(x => x.tier === tier);
  if (!t?.enabled) { toast('这一档还没有开放', 'info'); return; }
  if (!S.plans?.online_payment) {
    recharge();
    S.form.note = `在线支付即将开放。已有${t.name}订阅兑换码的话，在这里兑换即可开通。`;
    return;
  }
  unavailable('在线购买订阅');
}

export async function redeem() {
  const f = S.form;
  update(() => { f.redeeming = true; f.error = ''; });
  try {
    const d = await redeemCode(String(f.code || '').trim());
    closeModal();
    if (d.plan) toast(`已开通${d.plan.name}${d.plan.ends_at ? `，${new Date(d.plan.ends_at * 1000).toLocaleDateString('zh-CN')} 到期` : ''}`, 'crown');
    else toast(d.credited ? `兑换成功，已到账 ${d.added} 点` : `兑换成功，${d.added} 点稍后到账`, 'wallet');
  } catch (e) {
    update(() => { f.redeeming = false; f.error = e instanceof Error ? e.message : String(e); });
  }
}

/* ---------- 添加模型（自带 API Key）：真实保存到 lom-core ---------- */
export const addKey = () => {
  S.form = { provider: 'custom', baseUrl: '', fullUrl: false, key: '', model: '', vision: 'auto', apiMode: 'auto', models: [], listing: false, listError: '', saving: false, error: '' };
  openModal('addKey');
};

const presetOf = (id: string) => PROVIDER_PRESETS.find(p => p.id === id) ?? PROVIDER_PRESETS[0];

/** 切换平台：带出该平台的默认地址（自定义清空），模型列表作废 */
export function pickProvider(id: string) {
  update(() => { const f = S.form; f.provider = id; f.baseUrl = presetOf(id).baseUrl; f.models = []; f.listError = ''; f.error = ''; });
}

/** 搜索按钮：用填写的地址和 Key 读取模型列表，供选择 */
export async function fetchModelChoices() {
  const f = S.form;
  update(() => { f.listing = true; f.listError = ''; });
  try {
    const models = await listModels({ preset: presetOf(f.provider), baseUrl: f.baseUrl, apiKey: f.key });
    update(() => { f.models = models; f.listing = false; if (!models.length) f.listError = '这个 Key 没有读到可用的模型，可以直接手动填写模型名称'; });
  } catch (e) {
    update(() => { f.listing = false; f.models = []; f.listError = e instanceof Error ? e.message : String(e); });
  }
}

export async function saveKey() {
  const f = S.form;
  update(() => { f.saving = true; f.error = ''; });
  try {
    const r = await addProvider({ preset: presetOf(f.provider), baseUrl: f.baseUrl, fullUrl: !!f.fullUrl, apiKey: f.key, model: f.model, vision: f.vision || 'auto', apiMode: f.apiMode || 'auto' });
    closeModal();
    if (r.testError) toast(`已添加，但连接测试没通过：${r.testError}`, 'info');
    else toast(`已添加 ${f.model.trim()}，连接正常（${r.latency} 毫秒）`, 'key');
  } catch (e) {
    update(() => { f.saving = false; f.error = e instanceof Error ? e.message : String(e); });
  }
}

export async function testKey(id: string) {
  try {
    const ms = await testProvider(id);
    toast(`连接正常 · 延迟 ${ms}ms`, 'check');
  } catch (e) {
    toastError('连接失败', e);
  }
}

export const deleteKey = (id: string) => confirm({
  title: '删除这个模型服务？', desc: '使用它的任务需要换一个模型才能继续。', okText: '删除', danger: true,
  onOk: () => { deleteProvider(id).then(() => toast('已删除', 'trash'), e => toastError('删除失败', e)); },
});

export const exportData = () => unavailable('完整数据导出');
export const clearCache = () => confirm({ title: '清除预览缓存？', desc: '只清除预览快照，不影响任务和设置。', okText: '清除', onOk: () => { update(s => { s.previewHtml = ''; }); toast('缓存已清除', 'trash'); } });
/** 只恢复示例团队：真实团队、偏好、目标、文件夹和模型选择等本机设置都保留（示例手机和定时任务本来就不保存） */
export function restoreDemoTeams<T extends Record<string, unknown>>(saved: T): T & { teams: Team[] } {
  const real = Array.isArray(saved.teams) ? (saved.teams as Team[]).filter(t => t.real) : [];
  return { ...saved, teams: [...initialState().teams.filter(t => !t.real), ...real] };
}
export const resetDemo = () => confirm({
  title: '重置演示数据？', desc: '会刷新界面并恢复示例团队；你建的真实团队、偏好设置、电脑任务和模型服务都不受影响。', okText: '重置', danger: true,
  onOk: () => {
    try { localStorage.setItem('lom-desktop-v1', JSON.stringify(restoreDemoTeams(JSON.parse(localStorage.getItem('lom-desktop-v1') || '{}')))); }
    catch (e) { console.warn('settings.reset_demo_failed', e); toastError('重置失败', e); return; }
    location.reload();
  },
});
export const checkUpdate = () => { openModal('update'); void desktopUpdater.check(); };

export async function saveAccountProfile() {
  const f = S.form;
  if (f.saving) return;
  update(() => { f.saving = true; f.error = ''; });
  try {
    await saveProfile(String(f.name).trim(), f.avatar);
    if (S.form === f) closeModal();
    toast('资料已保存', 'check');
  } catch (e) {
    update(() => { f.saving = false; f.error = e instanceof Error ? e.message : String(e); });
  }
}
