import { cachedOptions, cachedOptionsAt, modelOption, type AgentChoice } from '@/features/settings/runtime/agentOptions';
import { S } from '@/state/store';

/** TEAM-ORCH-04：团队成员与外部 Agent 默认模型。'auto' 表示不指定、沿用 Agent 当前默认。 */
export const AUTO_MODEL = 'auto';

const STALE_NOTE = '这份列表来自本机缓存，可能不是最新；如果 Agent 新增了模型，请先在该 Agent 的任务里重新读取模型列表（或到设置测试连接）再重试。';
const cacheNote = (agentId: string) => {
  const at = cachedOptionsAt(agentId);
  return at ? `${STALE_NOTE}缓存时间：${new Date(at).toISOString()}。` : `${STALE_NOTE}缓存没有记录读取时间。`;
};

/** 该 Agent 上次读到的可选模型；从没读到过返回 undefined（不等于「没有模型」）。 */
export function knownModels(agentId: string): AgentChoice[] | undefined {
  const list = modelOption(cachedOptions(agentId))?.options;
  return list?.length ? list : undefined;
}

/** 校验并规整一个成员模型：'auto'/空 → undefined（沿用默认）；已知列表里没有 → 抛错；列表未知则放行，由核心启动时校验。 */
export function checkedModel(agentId: string, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > 160) throw new Error('model 必须是 1 至 160 字的文本，或 auto');
  const model = value.trim();
  if (!model || model === AUTO_MODEL) return undefined;
  const known = knownModels(agentId);
  if (known && !known.some(c => c.value === model)) throw new Error(`该 Agent 没有模型「${model}」；可选：${known.map(c => c.value).slice(0, 20).join('、')}。${cacheNote(agentId)}`);
  return model;
}

/** 创建团队时实际给成员用的模型：成员自己指定的优先，其次是该 Agent 的默认选择，空串表示让核心用 Agent 当前默认。 */
export const memberModelFor = (agentId: string, picked?: string) => picked || S.agentModelPick[agentId] || '';

/** 读一个外部 Agent 的默认模型和可选列表。 */
export function describeAgentModel(agentId: string) {
  const option = modelOption(cachedOptions(agentId));
  const models = (option?.options || []).slice(0, 50).map(c => ({ id: c.value, name: c.name || c.value }));
  const pick = S.agentModelPick[agentId];
  return { agent_id: agentId, default_model: pick || option?.current_value || null, source: pick ? 'desktop_preference' : option?.current_value ? 'agent_reported' : 'unknown',
    available_models: models, models_known: models.length > 0,
    ...(models.length ? { models_cached_at: cachedOptionsAt(agentId) ? new Date(cachedOptionsAt(agentId)!).toISOString() : null, models_note: cacheNote(agentId) } : {}) };
}
