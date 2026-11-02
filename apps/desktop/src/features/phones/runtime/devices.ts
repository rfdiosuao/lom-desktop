import { syncPhoneName } from './deviceName';
import { syncDeviceStatus } from './deviceStatus';
import { DeviceTransitions } from './deviceTransitions';
import { toast } from '@/shared/overlays/controller';
const transitions = new DeviceTransitions();
import { invoke } from '@tauri-apps/api/core';
import type { AppState } from '@/state/state';
import { S, update } from '@/state/store';
import type { Agent } from '@/state/types';
import { cloud } from '@/features/account/runtime/cloud';
import { authAccount } from '@/features/account/runtime/authScope';
import { restoreLegacyDeviceMembers, saveDeviceAccount, syncDeviceAccount } from './accountDeviceConfig';

/* ===== 添加手机（R01）与已配对的手机：访问云端配对 / 设备接口，以及外壳里的密钥计算 =====
 * psk 和安装私钥只在桌面外壳（Rust）里；这里拿到的是二维码 SVG、确认码和核对结果。 */

export interface PairingSession { pairingId: string; manualCode: string; expiresAt: number; qrSvg: string; }
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
  const id = await invoke<Identity>('pairing_identity');
  const c = await cloud<Created>('POST', '/v1/pairing/sessions', { install_id: id.installId, desktop_name: id.name, desktop_keys: id.keys });
  const qrSvg = await invoke<string>('pairing_qr', { host: c.host, pairingId: c.pairing_id, claimToken: c.claim_token });
  return { pairingId: c.pairing_id, manualCode: c.manual_code, expiresAt: c.expires_at * 1000, qrSvg };
}

export const pairingStatus = (id: string) => cloud<PairingStatus>('GET', `/v1/pairing/sessions/${encodeURIComponent(id)}`);

/** 扫码路径：用本机 psk 核对 key_proof，并把结果告诉云端（失败时会话作废） */
export async function verifyProof(id: string, deviceKeys: string, keyProof: string): Promise<boolean> {
  const ok = await invoke<boolean>('pairing_check_proof', { pairingId: id, deviceKeys, keyProof });
  await cloud('POST', `/v1/pairing/sessions/${encodeURIComponent(id)}/verify`, { ok });
  return ok;
}

export const confirmationCode = (id: string, deviceKeys: string) => invoke<string>('pairing_sas', { pairingId: id, deviceKeys });

/** 刷新或关闭弹窗：作废云端会话并丢弃 psk */
export async function abortPairing(id: string) {
  try { await invoke('pairing_forget'); } finally {
    await cloud('DELETE', `/v1/pairing/sessions/${encodeURIComponent(id)}`);
  }
}

export const listDevices = () => cloud<CloudDevice[]>('GET', '/v1/devices');
export async function removeDevice(id: string) {
  const isCurrent = authAccount();
  if (!isCurrent()) throw new Error('请先登录');
  await cloud('DELETE', `/v1/devices/${encodeURIComponent(id)}`);
  if (!isCurrent()) throw new Error('账号已切换，请重新查看设备');
}
export async function renameDevice(id: string, value: string) {
  const name = value.trim();
  if (!name || name.length > 100 || /[\x00-\x1f]/.test(name)) throw new Error('名称需为 1–100 个有效字符');
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
  s.phoneOrder = s.phoneOrder.filter(x => x !== id);
  delete s.lit[id];
  delete s.agents[id];
  if (s.phoneId === id) s.phoneId = s.phoneOrder[0];
  s.teams.forEach(t => { t.members = t.members.filter(m => m.agent !== id); });
  saveDeviceAccount(s);
}

export function applyDevices(list: CloudDevice[]) {
  syncDeviceAccount();
  if (S.cloud !== 'signed-in' || !S.account) return;
  const messages=transitions.observe(S.cloud === 'signed-in' ? S.account?.id : undefined,list,!!S.prefs.notify);
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
      if (!s.phoneOrder.includes(d.id)) addPhone(s, d.id);
    }
    for (const id of [...s.phoneOrder]) if (s.agents[id]?.real && !ids.has(id)) dropPhone(s, id);
  });
  restoreLegacyDeviceMembers(new Set(list.map(d => d.id)));
  saveDeviceAccount();
  if(messages.length) toast(messages.join('；'), 'phone');
}

/** 刷新手机列表与在线状态；未登录时移除所有真实手机（只影响界面，云端绑定不变） */
export async function syncDevices() {
  syncDeviceAccount();
  if (S.cloud !== 'signed-in') {
    transitions.observe(undefined, [], false);
    return;
  }
  try {
    const isCurrent = authAccount();
    const list = await listDevices();
    if (isCurrent()) { applyDevices(list); for (const d of list) if (d.online) { void syncDeviceStatus(d.id); void syncPhoneName(d.id, d.name).catch(() => { /* Old/offline APK: retry next refresh, never claim synced. */ }); } }
  } catch (e) {
    /* 后台刷新：网络暂时不通时保留上一次的列表，下个周期再试 */
    console.warn('读取手机列表失败', e);
  }
}

/** 每 15 秒刷新一次在线状态（R01 §2.8 第一版范围：电脑端轮询） */
export function startDevicesTimer() {
  window.setInterval(() => { void syncDevices(); }, 15_000);
}
