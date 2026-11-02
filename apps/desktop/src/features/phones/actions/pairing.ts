import { invoke } from '@tauri-apps/api/core';
import { syncPhoneModel } from '../runtime/phoneModel';
import { CloudError, signIn } from '@/features/account/runtime/cloud';
import { loadPlans } from '@/features/account/runtime/plans';
import { phones } from '@/state/selectors';
import { inShell } from '@/core/platform';
import { abortPairing, confirmationCode, pairingStatus, startPairing, syncDevices, verifyProof } from '../runtime/devices';
import { S, update } from '@/state/store';
import { navigate } from '@/app/navigation';
import { openModal } from '@/shared/overlays/controller';

/* ===== 添加手机（R01）：真实二维码与配对码，手机确认后才显示「已连接」 =====
 * 弹窗状态：signin（未登录）→ loading → waiting（等扫码 / 输码）→ scanned（扫码已核对，等手机确认）
 *          或 sas（配对码路径，显示确认码）→ done；任何失败进入 error，可刷新重来。 */

type Stage = 'signin' | 'limit' | 'loading' | 'waiting' | 'scanned' | 'sas' | 'done' | 'error';

let current: { id: string; checked: boolean } | null = null;
let ticking = false;

const modal = () => S.modals.find(m => m.id === 'pair');
const set = (props: Record<string, unknown> & { stage?: Stage }) => update(() => { const m = modal(); if (m) Object.assign(m.props, props); });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function pair() {
  openModal('pair', { tab: 'qr', stage: 'loading' });
  void begin();
}

export const pairTab = (v: string) => set({ tab: v });

async function begin() {
  const m = modal();
  if (!m) return;
  if (!inShell()) { set({ stage: 'error', error: '添加手机需要在麓鸣桌面应用中进行（浏览器开发模式无法生成配对密钥）。' }); return; }
  if (S.cloud !== 'signed-in') { set({ stage: 'signin' }); return; }
  set({ stage: 'loading', error: '', warn: '', sas: '', deviceName: '' });
  // 订阅的手机台数（A03 §2.2）：已满就不生成二维码和配对码，服务端也会拒绝
  if (!S.subscription) await loadPlans();
  const max = S.subscription?.plan.max_phones;
  const used = phones().filter(p => p.real).length;
  if (max != null && used >= max) { set({ stage: 'limit', max, used }); return; }
  try {
    const session = await startPairing();
    if (modal() !== m) { void abortPairing(session.pairingId).catch(e => console.warn('作废配对会话失败（5 分钟后自动过期）', e)); return; }
    current = { id: session.pairingId, checked: false };
    set({ stage: 'waiting', pairingId: session.pairingId, code: session.manualCode, qrSvg: session.qrSvg, expires: session.expiresAt });
  } catch (e) {
    if (e instanceof CloudError && e.code === 'sub.phone_limit') { await loadPlans(); set({ stage: 'limit', max: S.subscription?.plan.max_phones ?? used, used }); return; }
    set({ stage: 'error', error: `无法生成配对码：${message(e)}` });
  }
}

/** 每秒调用一次：轮询云端会话状态（R01 §2.8 第一版范围） */
export async function pairTick() {
  const cur = current;
  if (!cur || ticking || !modal()) return;
  ticking = true;
  try {
    const st = await pairingStatus(cur.id);
    if (current !== cur) return;
    set({ warn: '' });
    const deviceName = st.device_info?.name || st.device_info?.model || '手机';
    if (st.state === 'claimed' && st.method === 'qr' && !cur.checked && st.device_keys && st.key_proof) {
      cur.checked = true;
      const ok = await verifyProof(cur.id, st.device_keys, st.key_proof);
      set(ok ? { stage: 'scanned', deviceName } : { stage: 'error', error: '配对校验失败，请刷新二维码重试。' });
      if (!ok) current = null;
    } else if (st.state === 'claimed' && st.method === 'code' && modal()?.props.stage !== 'sas' && st.device_keys) {
      set({ stage: 'sas', deviceName, sas: await confirmationCode(cur.id, st.device_keys) });
    } else if (st.state === 'confirmed') {
      current = null;
      await syncDevices();
      update(s => { if (st.device_id) s.lit[st.device_id] = true; });
      let modelSync = '已配对';
      if (st.device_id && st.device_keys) {
        try {
          await invoke('remote_pin', { deviceId: st.device_id, keys: st.device_keys });
          // The phone establishes its relay after credential persistence.
          let last: unknown;
          for (let n = 0; n < 5; n++) {
            try { await syncPhoneModel(st.device_id, true); last = null; break; }
            catch (e) { last = e; await new Promise(r => setTimeout(r, 1000)); }
          }
          if (last) throw last;
          modelSync = '模型已同步到手机';
        } catch (e) { modelSync = `配对成功，模型尚未同步：${message(e)}`; }
      }
      set({ stage: 'done', newId: st.device_id, deviceName, warn: modelSync });
    } else if (['cancelled', 'expired', 'failed'].includes(st.state)) {
      current = null;
      const why = { cancelled: '手机已取消连接。', expired: '配对已过期，请刷新二维码。', failed: '配对校验失败，请刷新二维码重试。' } as Record<string, string>;
      set({ stage: 'error', error: why[st.state] });
    }
  } catch (e) {
    set({ warn: `暂时无法连接麓鸣服务，正在重试…（${message(e)}）` });
  } finally {
    ticking = false;
  }
}

export async function pairRefresh() {
  const cur = current;
  current = null;
  if (cur) await abortPairing(cur.id).catch(e => console.warn('作废旧配对会话失败（5 分钟后自动过期）', e));
  await begin();
}

/** 弹窗关闭：作废未完成的会话，丢弃 psk */
export function pairClosed() {
  const cur = current;
  current = null;
  if (cur) void abortPairing(cur.id).catch(e => console.warn('作废配对会话失败（5 分钟后自动过期）', e));
}

export async function pairSignedIn() {
  await signIn();
  if (S.cloud === 'signed-in') await begin();
}

export const pairNext = (id: string, route: string) => { S.modals = []; navigate({ mode: 'phone', phoneId: id, route: { name: route }, wsTab: 'phone' }); };
