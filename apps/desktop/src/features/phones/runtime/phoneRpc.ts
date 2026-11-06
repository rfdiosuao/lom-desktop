import { invoke } from '@tauri-apps/api/core';
import { cloud } from '@/features/account/runtime/cloud';
import type { Envelope, RpcRequest, RpcResponse } from '@/core/remoteWire';
import { S } from '@/state/store';
import { authAccount } from '@/features/account/runtime/authScope';
import { recordRpc } from './deviceLink';
import { lanMode } from './deviceLink';
import { recordUnsupported } from './phoneCapabilities';

/** Payloads never enter UI state/logging/storage. Only encrypted envelopes cross the cloud. */
export async function phoneRpc<T>(device: string, method: string, payload: unknown): Promise<T> {
  const lan = lanMode();
  if (!lan && S.cloud !== 'signed-in') throw new Error('请先在电脑登录');
  const isCurrent = lan ? () => true : authAccount();
  if (!isCurrent()) throw new Error('请先在电脑登录');
  const id = crypto.randomUUID().replaceAll('-', '');
  const request: RpcRequest = { method, payload: JSON.stringify(payload), issued_at: Date.now().toString() };
  const envelope = await invoke<Envelope>('remote_seal', { deviceId: device, id, text: JSON.stringify(request) });
  if (!isCurrent()) throw new Error('账号已切换，已停止同步');
  let decoded: string;
  try {
    const response = lan
      ? await invoke<Envelope>('lan_rpc', { deviceId: device, envelope })
      : await cloud<Envelope>('POST', `/v1/devices/${encodeURIComponent(device)}/rpc`, envelope);
    if (!isCurrent()) throw new Error('账号已切换，已停止同步');
    if (response.id !== id) throw new Error('手机回复与请求不匹配');
    decoded = await invoke<string>('remote_open', { deviceId: device, envelope: response });
  } catch (e) {
    // 没拿到可解密的回复：RPC 不可用（与手机是否显示在线分开记录）
    if (isCurrent()) recordRpc(device, false, e instanceof Error ? e.message : String(e));
    throw e;
  }
  if (!isCurrent()) throw new Error('账号已切换，已停止同步');
  recordRpc(device, true);
  const data: RpcResponse = JSON.parse(decoded);
  if (data.status !== 'ok') {
    /* 文案会翻译 sync.conflict；保留原始错误码给调用方区分“确定未执行”和“结果未知” */
    const error = new Error(data.error === 'sync.conflict' ? '手机内容已更新，未覆盖。请保留草稿并重新载入手机版本。' : data.error) as Error & { code?: string };
    error.code = data.error;
    if (data.error === 'remote.method_unknown') recordUnsupported(device, method); // PHONE-CAPS-01：记入该手机的「不支持」缓存
    throw error;
  }
  return JSON.parse(data.payload) as T;
}
