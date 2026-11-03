import { syncPhoneName } from './deviceName';
import { dropLink, lanMode, observeDevice } from './deviceLink';
import { syncDeviceStatus } from './deviceStatus';
import { DeviceTransitions } from './deviceTransitions';
import { toast } from '@/shared/overlays/controller';
const transitions = new DeviceTransitions();
import { invoke } from '@tauri-apps/api/core';
import type { AppState } from '@/state/state';
export { lanMode } from './deviceLink';
import { S, update } from '@/state/store';
import type { Agent } from '@/state/types';
import { cloud } from '@/features/account/runtime/cloud';
import { authAccount } from '@/features/account/runtime/authScope';
import { restoreLegacyDeviceMembers, saveDeviceAccount, syncDeviceAccount } from './accountDeviceConfig';

/* ===== 添加手机（R01）与已配对的手机：访问云端配对 / 设备接口，以及外壳里的密钥计算 =====
 * psk 和安装私钥只在桌面外壳（Rust）里；这里拿到的是二维码 SVG、确认码和核对结果。 */

export interface PairingSession { pairingId: string; manualCode: string; expiresAt: number; qrSvg: string; }
interface LanDevice { id: string; name: string; model: string; os: string; app_version: string; keys: string; online: boolean; last_seen_at: number; }
interface LanStart { pairingId: string; qrSvg: string; expiresAt: number; }
interface LanStatus { state: string; device_id?: string | null; device_name?: string | null; device_keys?: string | null; }
export interface DeviceInfo { name: string; model: string; os: string; app_version: string; }
export interface PairingStatus {
  state: 'open' | 'claimed' | 'verified' | 'confirmed' | 'cancelled' | 'expired' | 'failed';
  method: 'qr' | 'code' | null; device_keys: string | null; device_info: DeviceInfo | null;
  key_proof: string | null; device_id: string | null;
}
export interface CloudDevice { id: string; name: string; keys: string; info: DeviceInfo; paired_at: number; last_seen_at: number; online: boolean; }

interface Identity { installId: string; keys: string; name: string; }
interface Created { pairing_id: string; claim_token: string; manual_code: string; expires_at: number; host: string; }

export async function startPairing(): Promise<PairingSession> {
  if (lanMode()) {
    const r = await invoke<LanStart>('lan_pair_start');
    return { pairingId: r.pairingId, manualCode: '', expiresAt: r.expiresAt * 1000, qrSvg: r.qrSvg };
  }
  const id = await invoke<Identity>('pairing_identity');
  const c = await cloud<Created>('POST', '/v1/pairing/sessions', { install_id: id.installId, desktop_name: id.name, desktop_keys: id.keys });
  const qrSvg = await invoke<string>('pairing_qr', { host: c.host, pairingId: c.pairing_id, claimToken: c.claim_token });
  return { pairingId: c.pairing_id, manualCode: c.manual_code, expiresAt: c.expires_at * 1000, qrSvg };
}

export async function pairingStatus(id: string): Promise<PairingStatus> {
  if (lanMode()) {
    const r = await invoke<LanStatus>('lan_pair_status', { pairingId: id });
    return { state: r.state as PairingStatus['state'], method: 'qr', device_keys: r.device_keys ?? null,
      device_info: r.device_name ? { name: r.device_name, model: '', os: '', app_version: '' } : null,
      key_proof: null, device_id: r.device_id ?? null };
  }
  return cloud<PairingStatus>('GET', `/v1/pairing/sessions/${encodeURIComponent(id)}`);
}

/** 扫码路径：用本机 psk 核对 key_proof，并把结果告诉云端（失败时会话作废） */
export async function verifyProof(id: string, deviceKeys: string, keyProof: string): Promise<boolean> {
  if (lanMode()) return true;
  const ok = await invoke<boolean>('pairing_check_proof', { pairingId: id, deviceKeys, keyProof });
  await cloud('POST', `/v1/pairing/sessions/${encodeURIComponent(id)}/verify`, { ok });
  return ok;
}

export const confirmationCode = (id: string, deviceKeys: string) => lanMode() ? Promise.resolve('') : invoke<string>('pairing_sas', { pairingId: id, deviceKeys });

/** 刷新或关闭弹窗：作废云端会话并丢弃 psk */
export async function abortPairing(id: string) {
  if (lanMode()) { await invoke('lan_pair_cancel', { pairingId: id }); return; }
  try { await invoke('pairing_forget'); } finally {
    await cloud('DELETE', `/v1/pairing/sessions/${encodeURIComponent(id)}`);
  }
}

export async function listDevices(): Promise<CloudDevice[]> {
  if (lanMode()) {
    const rows = await invoke<LanDevice[]>('lan_devices');
    return rows.map(d => ({ id: d.id, name: d.name, keys: d.keys, info: { name: d.name, model: d.model, os: d.os, app_version: d.app_version }, paired_at: d.last_seen_at, last_seen_at: d.last_seen_at, online: d.online }));
  }
  return cloud<CloudDevice[]>('GET', '/v1/devices');
}
export async function removeDevice(id: string) {
  if (lanMode()) { await invoke('lan_remove_device', { deviceId: id }); return; }
  const isCurrent = authAccount();
  if (!isCurrent()) throw new Error('请先登录');
  await cloud('DELETE', `/v1/devices/${encodeURIComponent(id)}`);
  if (!isCurrent()) throw new Error('账号已切换，请重新查看设备');
}
export async function renameDevice(id: string, value: string) {
  const name = value.trim();
  if (!name || name.length > 100 || /[\x00-\x1f]/.test(name)) throw new Error('名称需为 1–100 个有效字符');
  if (lanMode()) { await invoke('lan_rename_device', { deviceId: id, name }); update(s => { if (s.agents[id]) s.agents[id].name = name; }); return true; }
  const isCurrent = authAccount();
  if (!isCurrent()) throw new Error('请先登录');
  await cloud('PATCH', `/v1/devices/${encodeURIComponent(id)}`, { name });
  if (!isCurrent()) throw new Error('账号已切换，请重新查看设备');
  update(s => { if (s.agents[id]) s.agents[id].name = name; });
  try { await syncPhoneName(id, name); return true; }
  catch { return false; } // Cloud is durable; periodic sync retries and UI explicitly says pending.
}

/* ---------- 同步到界面：真实手机标记 real，与演示手机并列显示 ---------- */

function addPhone(s: AppState, id: string) {
  s.phoneOrder.push(id);
  s.installed[id] ||= []; s.subagents[id] ||= []; s.souls[id] ??= ''; s.memories[id] ||= []; s.customGroups[id] ||= [];
}

export function dropPhone(s: AppState, id: string) {
  dropLink(id);
  s.phoneOrder = s.phoneOrder.filter(x => x !== id);
  delete s.lit[id];
  delete s.agents[id];
  if (s.phoneId === id) s.phoneId = s.phoneOrder[0];
  s.teams.forEach(t => { t.members = t.members.filter(m => m.agent !== id); });
  saveDeviceAccount(s);
}

export function applyDevices(list: CloudDevice[]) {
  syncDeviceAccount();
  if (!lanMode() && (S.cloud !== 'signed-in' || !S.account)) return;
  const messages=transitions.observe(lanMode() ? 'lan' : S.cloud === 'signed-in' ? S.account?.id : undefined,list,!!S.prefs.notify);
  update(s => {
    const ids = new Set(list.map(d => d.id));
    for (const d of list) {
      const old = s.agents[d.id];
      const next: Agent = {
        ...old, id: d.id, kind: 'phone', name: d.name, persona: old?.persona || '', real: true,
        status: d.online ? 'online' : 'offline', device: [d.info.model, d.info.os].filter(Boolean).join(' · '),
        lastSeen: d.last_seen_at * 1000, model: old?.model || s.phoneModel,
      };
      if (!d.online) { next.battery = undefined; next.network = undefined; }
      s.agents[d.id] = next;
      observeDevice(d.id, !!d.online);
      if (!s.phoneOrder.includes(d.id)) addPhone(s, d.id);
    }
    for (const id of [...s.phoneOrder]) if (s.agents[id]?.real && !ids.has(id)) dropPhone(s, id);
  });
  restoreLegacyDeviceMembers(new Set(list.map(d => d.id)));
  saveDeviceAccount();
  if(messages.length) toast(messages.join('；'), 'phone');
}

/** 刷新手机列表与在线状态；未登录时移除所有真实手机（只影响界面，云端绑定不变） */
let syncing: { current: () => boolean; promise: Promise<void> } | undefined;
export async function syncDevices() {
  syncDeviceAccount();
  if (!lanMode() && S.cloud !== 'signed-in') { transitions.observe(undefined, [], false); return; }
  if (syncing?.current()) return syncing.promise;
  const current = lanMode() ? () => true : authAccount();
  const entry = { current, promise: Promise.resolve() };
  entry.promise = (async () => {
    try {
      const list = await listDevices();
      if (!current()) return;
      applyDevices(list);
      for (const d of list) if (d.online) {
        void syncDeviceStatus(d.id);
        void syncPhoneName(d.id, d.name).catch(() => { /* Old/offline APK: retry next refresh, never claim synced. */ });
      }
    } catch (e) {
      // Keep the last snapshot; an explicit recovery or the next poll may retry.
      console.warn('读取手机列表失败', e);
    }
  })().finally(() => { if (syncing === entry) syncing = undefined; });
  syncing = entry;
  return entry.promise;
}
/** If a wake event joined an old request, make one fresh attempt after it settles. */
export async function refreshDevicesNow() {
  const current = authAccount(), pending = syncing?.current();
  await syncDevices();
  if (pending && current()) await syncDevices();
}
let deviceTimer:ReturnType<typeof setInterval>|undefined;
const refreshOnWake=()=>{if(!document.hidden)void refreshDevicesNow();};
/** Poll normally, and refresh immediately when the desktop resumes or regains its network. */
export function startDevicesTimer() {
  if(deviceTimer)return;
  deviceTimer=window.setInterval(()=>{void syncDevices();},15000);
  window.addEventListener('online',refreshOnWake);
  document.addEventListener('visibilitychange',refreshOnWake);
}
export function stopDevicesTimer() {
  if(deviceTimer!==undefined)clearInterval(deviceTimer);
  deviceTimer=undefined;
  window.removeEventListener('online',refreshOnWake);
  document.removeEventListener('visibilitychange',refreshOnWake);
}
