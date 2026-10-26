import { api } from '@/core/client';
import { phoneRpc } from './phoneRpc';
import { authRevision } from '@/features/account/runtime/authScope';
import { ensureLomSelection } from '@/features/account/runtime/cloud';
import { S } from '@/state/store';
import { phoneModelChoice, phoneModelLabel } from '@/state/selectors';
import type { ModelConfig } from '@/core/remoteWire';
import type { CoreProvider } from '@/core/types';

/** Device → digest of the model config the phone last confirmed. Memory only; the key itself is never kept. */
const confirmed = new Map<string, string>();

async function digest(c: ModelConfig): Promise<string> {
  const text = [c.base_url, c.model, c.platform, c.api_key].join('\n');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

/** 这台手机生效的模型选择：手机自己选的 > 手机默认模型；两者都为空才表示“跟随电脑”。
 *  返回原始选择值和它是否来自用户的明确选择，供发送前区分“未选择”与“已选择但失效”。 */
function phoneModelSelection(device: string): { raw: string; explicit: boolean } {
  const own = (S.agents[device]?.model || '').trim();
  if (own) return { raw: own, explicit: true };
  const shared = (S.phoneModel || '').trim();
  return { raw: shared, explicit: Boolean(shared) };
}

/** Read the actual chosen desktop provider, including BYOK. No silent fallback to points billing.
 *  Sends the key to the phone only when the config changed since the phone last confirmed it, or when `force`d. */
export async function syncPhoneModel(device: string, force = false) {
  const auth = authRevision(), owner = S.account?.id;
  const current = () => auth() && S.account?.id === owner;
  // 这台手机自己选的 > 手机默认模型 > 跟随电脑主控
  const selection = phoneModelSelection(device);
  const target = selection.raw || S.model;
  await ensureLomSelection(target);
  const chosen = phoneModelChoice(target);
  if (!chosen || chosen.unavailable) {
    throw new Error(selection.explicit
      ? `手机选择的模型「${phoneModelLabel(selection.raw)}」已失效，请重新选择手机模型后再发送，未改用电脑模型`
      : '手机跟随的电脑模型当前不可用，请先在电脑上重新选择模型');
  }
  const id = chosen.id;
  const split = id.indexOf('::');
  if (split < 1) throw new Error('请先选择手机使用的模型，再同步到手机');
  const providerId = id.slice(0, split), model = id.slice(split + 2);
  const providers = await api<(CoreProvider & { api_key: string; model_settings?: Record<string, { openai_api_mode?: string }> })[]>('GET', '/api/providers');
  if (!current()) { providers.forEach(x => { x.api_key = ''; }); throw new Error('账号已切换，未同步旧手机模型'); }
  const p = providers.find(x => x.id === providerId && x.enabled);
  if (!p || !p.models.includes(model) || !p.api_key) throw new Error('手机使用的模型缺少可用的 API Key');
  const platform = p.platform === 'openai' && p.model_settings?.[model]?.openai_api_mode === 'responses' ? 'openai-responses' : p.platform;
  const payload: ModelConfig = { base_url: p.base_url, api_key: p.api_key, model, platform, revision: Date.now().toString() };
  try {
    const fingerprint = await digest(payload);
    if (!current()) throw new Error('账号已切换，未发送旧手机模型');
    if (!force && confirmed.get(device) === fingerprint) return { status: 'unchanged', model };
    confirmed.delete(device);
    const reply = await phoneRpc<{ status: string; model: string }>(device, 'model.sync', payload);
    if (!current()) throw new Error('账号已切换，未登记旧模型同步结果');
    confirmed.set(device, fingerprint);
    return reply;
  } finally { payload.api_key = ''; providers.forEach(x => { x.api_key = ''; }); }
}

/** Before sending work to a phone: make sure it runs the desktop's current model, without re-sending an unchanged key. */
export const ensurePhoneModel = (device: string) => syncPhoneModel(device);
