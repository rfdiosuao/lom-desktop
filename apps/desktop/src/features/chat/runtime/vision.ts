import { invoke } from '@tauri-apps/api/core';
import { api } from '@/core/client';
import { LOM_PROVIDER_NAME } from '@/features/account/runtime/builtin';
import { S } from '@/state/store';
import type { CoreProvider } from '@/core/types';

/* ===== 看图工具 lom_view_image：当前模型看不到图片时，请麓鸣云端的看图模型代看 =====
 * 用的是本账号自己的 Lom 云端令牌（按积分计费）；密钥只在这次调用里经过内存，不保存。 */

const textResult = (text: string, isError = false) => ({ ...(isError ? { isError: true } : {}), content: [{ type: 'text', text }] });

/** 只选择服务端明确声明支持看图的档位，不猜测默认值 */
function visionModel() {
  const m = S.cloudModels;
  if (!m) return '';
  const tier = (S.cloudVision ?? [])[0] as keyof typeof m | undefined;
  return tier ? m[tier] : '';
}

export async function viewImageTool(args: Record<string, unknown>, current: () => boolean = () => true) {
  const path = String(args.file_path || '').trim();
  const question = String(args.question || '').trim();
  if (!path) return textResult('缺少图片路径 file_path', true);
  if (!current()) return textResult('vision.cancelled', true);
  if (S.cloudVision === undefined) return textResult('vision.unknown：尚未确认云端视觉能力，不调用模型', true);
  if (!S.cloudVision.length) return textResult('vision.unsupported：云端未声明可用看图档位', true);
  const model = visionModel();
  if (S.cloud !== 'signed-in') return textResult('看图需要登录麓鸣账号', true);
  if (!model) return textResult('vision.unknown：看图档位尚未关联可用模型', true);
  let providers: (CoreProvider & { api_key: string })[] = [];
  const owner = S.account?.id;
  try {
    providers = await api<(CoreProvider & { api_key: string })[]>('GET', '/api/providers');
    if (!current() || S.account?.id !== owner || S.cloud !== 'signed-in') return textResult('vision.cancelled', true);
    const p = providers.find(x => x.name === LOM_PROVIDER_NAME && x.enabled && x.api_key);
    if (!p) return textResult('Lom 云端模型未连接，暂时不能看图', true);
    const text = await invoke<string>('vision_describe', { path, question, baseUrl: p.base_url, apiKey: p.api_key, model });
    if (!current() || S.account?.id !== owner || S.cloud !== 'signed-in') return textResult('vision.cancelled', true);
    if (!text?.trim()) return textResult('vision.empty_description：看图模型未返回描述', true);
    return textResult(`图片 ${path} 的内容（由看图模型描述，仅作参考）：\n${text}`);
  } catch (e) {
    return textResult(e instanceof Error ? e.message : String(e), true);
  } finally { providers.forEach(x => { x.api_key = ''; }); }
}
