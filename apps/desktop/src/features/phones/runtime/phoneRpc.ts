import { invoke } from '@tauri-apps/api/core';
import { cloud } from '@/features/account/runtime/cloud';
import type { Envelope, RpcRequest, RpcResponse } from '@/core/remoteWire';
import { S } from '@/state/store';
import { authAccount } from '@/features/account/runtime/authScope';

/** Payloads never enter UI state/logging/storage. Only encrypted envelopes cross the cloud. */
export async function phoneRpc<T>(device: string, method: string, payload: unknown): Promise<T> {
  if (S.cloud !== 'signed-in') throw new Error('请先在电脑登录');
  const isCurrent = authAccount();
  if (!isCurrent()) throw new Error('请先在电脑登录');
  const id = crypto.randomUUID().replaceAll('-', '');
  const request: RpcRequest = { method, payload: JSON.stringify(payload), issued_at: Date.now().toString() };
  const envelope = await invoke<Envelope>('remote_seal', { deviceId: device, id, text: JSON.stringify(request) });
  if (!isCurrent()) throw new Error('账号已切换，已停止同步');
  const response = await cloud<Envelope>('POST', `/v1/devices/${encodeURIComponent(device)}/rpc`, envelope);
  if (!isCurrent()) throw new Error('账号已切换，已停止同步');
  if (response.id !== id) throw new Error('手机回复与请求不匹配');
  const decoded = await invoke<string>('remote_open', { deviceId: device, envelope: response });
  if (!isCurrent()) throw new Error('账号已切换，已停止同步');
  const data: RpcResponse = JSON.parse(decoded);
  if (data.status !== 'ok') {
    /* 文案会翻译 sync.conflict；保留原始错误码给调用方区分“确定未执行”和“结果未知” */
    const error = new Error(data.error === 'sync.conflict' ? '手机内容已更新，未覆盖。请保留草稿并重新载入手机版本。' : data.error) as Error & { code?: string };
    error.code = data.error;
    throw error;
  }
  return JSON.parse(data.payload) as T;
}
