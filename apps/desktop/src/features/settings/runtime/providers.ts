import { S, update } from '@/state/store';
import { isBuiltin } from '@/features/account/runtime/builtin';
import { api } from '@/core/client';
import { refreshProviders } from './providerSync';

/* ===== 模型服务（自带 API Key）：保存在 lom-core，密钥由核心加密存储 ===== */

export interface ProviderPreset { id: string; label: string; platform: string; baseUrl: string; openai?: boolean; }

/** 常用平台：地址可改；「自定义」填任意 OpenAI 兼容地址 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'custom', label: '自定义', platform: 'openai', baseUrl: '', openai: true },
  { id: 'deepseek', label: 'DeepSeek', platform: 'openai', baseUrl: 'https://api.deepseek.com/v1', openai: true },
  { id: 'openai', label: 'OpenAI', platform: 'openai', baseUrl: 'https://api.openai.com/v1', openai: true },
  { id: 'anthropic', label: 'Anthropic', platform: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  { id: 'gemini', label: 'Gemini', platform: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'qwen', label: '通义千问', platform: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', openai: true },
  { id: 'zhipu', label: '智谱 GLM', platform: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', openai: true },
  { id: 'moonshot', label: 'Kimi（月之暗面）', platform: 'openai', baseUrl: 'https://api.moonshot.cn/v1', openai: true },
  { id: 'siliconflow', label: '硅基流动', platform: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', openai: true },
  { id: 'volcengine', label: '火山方舟', platform: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', openai: true },
  { id: 'openrouter', label: 'OpenRouter', platform: 'openai', baseUrl: 'https://openrouter.ai/api/v1', openai: true },
];

type ModelInfo = string | { id: string; name?: string };
export type VisionSetting = 'auto' | 'supported' | 'unsupported';
export type ApiMode = 'auto' | 'chat_completions' | 'responses';

export interface ModelForm {
  preset: ProviderPreset; baseUrl: string; fullUrl: boolean; apiKey: string; model: string; vision: VisionSetting; apiMode: ApiMode;
}

const cleanUrl = (u: string) => u.trim().replace(/\/+$/, '');

/** 用填写的地址和 Key 读取这个平台的模型列表（不保存任何东西） */
export async function listModels(f: Pick<ModelForm, 'preset' | 'baseUrl' | 'apiKey'>): Promise<string[]> {
  const base = cleanUrl(f.baseUrl);
  if (!base) throw new Error('请先填写 API 请求地址');
  if (!f.apiKey.trim()) throw new Error('请先填写 API Key');
  const res = await api<{ models: ModelInfo[] }>('POST', '/api/providers/fetch-models', { platform: f.preset.platform, base_url: base, api_key: f.apiKey.trim(), try_fix: true });
  return res.models.map(m => (typeof m === 'string' ? m : m.id)).sort();
}

/** 只有用户明确选了才写进模型设置；「自动识别」交给核心按模型目录判断 */
export function modelSettings(f: Pick<ModelForm, 'vision' | 'apiMode' | 'preset'>) {
  const s: { image_input?: VisionSetting; openai_api_mode?: ApiMode } = {};
  if (f.vision !== 'auto') s.image_input = f.vision;
  if (f.preset.openai && f.apiMode !== 'auto') s.openai_api_mode = f.apiMode;
  return s;
}

/** 添加模型：保存到核心（Key 由核心加密），然后测一次连接，结果如实返回 */
export async function addProvider(f: ModelForm): Promise<{ id: string; latency?: number; testError?: string }> {
  const base = cleanUrl(f.baseUrl), model = f.model.trim(), key = f.apiKey.trim();
  if (!base) throw new Error('请填写 API 请求地址');
  if (!/^https?:\/\//.test(base)) throw new Error('API 请求地址要以 https:// 开头');
  if (!key) throw new Error('请填写 API Key');
  if (!model) throw new Error('请填写模型名称');
  const settings = modelSettings(f);
  const created = await api<{ id: string }>('POST', '/api/providers', {
    platform: f.preset.platform, name: f.preset.id === 'custom' ? new URL(base).hostname : f.preset.label, base_url: base, api_key: key,
    models: [model], enabled: true, is_full_url: f.fullUrl, ...(Object.keys(settings).length ? { model_settings: { [model]: settings } } : {}),
  });
  await refreshProviders();
  if (!S.model) update(s => { s.model = `${created.id}::${model}`; });
  try { return { id: created.id, latency: await testProvider(created.id) }; }
  catch (e) { return { id: created.id, testError: e instanceof Error ? e.message : String(e) }; }
}

/** 测试连接：用已保存的凭据拉取模型列表，返回耗时（毫秒） */
export async function testProvider(id: string) {
  const t0 = performance.now();
  await api('POST', `/api/providers/${id}/models`, { try_fix: false });
  return Math.round(performance.now() - t0);
}

export async function deleteProvider(id: string) {
  const p = S.providers.find(p => p.id === id);
  if (p && isBuiltin(p)) throw new Error('Lom 内置模型由账号管理，不能删除');
  await api('DELETE', `/api/providers/${id}`);
  await refreshProviders();
  if (S.model.startsWith(`${id}::`)) update(s => { s.model = ''; });
}
