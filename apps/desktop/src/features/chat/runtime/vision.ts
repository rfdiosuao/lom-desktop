import { invoke } from '@tauri-apps/api/core';
import { api } from '@/core/client';
import { LOM_PROVIDER_NAME } from '@/features/account/runtime/builtin';
import { S } from '@/state/store';
import type { CoreProvider } from '@/core/types';

/* ===== 看图工具 lom_view_image：当前模型看不到图片时，请麓鸣云端的看图模型代看 =====
 * 用的是本账号自己的 Lom 云端令牌（按积分计费）；密钥只在这次调用里经过内存，不保存。 */

const textResult = (text: string, isError = false) => ({ ...(isError ? { isError: true } : {}), content: [{ type: 'text', text }] });

/** 能看图的那一档模型（服务端下发，默认 Lom Pro） */
function visionModel() {
  const m = S.cloudModels;
  if (!m) return '';
  const tier = (S.cloudVision ?? ['pro'])[0] as keyof typeof m | undefined;
  return tier ? m[tier] : '';
}

export async function viewImageTool(args: Record<string, unknown>) {
  const path = String(args.file_path || '').trim();
  const question = String(args.question || '').trim();
  if (!path) return textResult('缺少图片路径 file_path', true);
  const model = visionModel();
  if (S.cloud !== 'signed-in' || !model) return textResult('看图需要登录麓鸣账号', true);
  const providers = await api<(CoreProvider & { api_key: string })[]>('GET', '/api/providers');
  try {
    const p = providers.find(x => x.name === LOM_PROVIDER_NAME && x.enabled && x.api_key);
    if (!p) return textResult('Lom 云端模型未连接，暂时不能看图', true);
    const text = await invoke<string>('vision_describe', { path, question, baseUrl: p.base_url, apiKey: p.api_key, model });
    return textResult(`图片 ${path} 的内容（由看图模型描述，仅作参考）：\n${text}`);
  } catch (e) {
    return textResult(e instanceof Error ? e.message : String(e), true);
  } finally { providers.forEach(x => { x.api_key = ''; }); }
}
