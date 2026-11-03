import { cloud, CloudError } from '@/features/account/runtime/cloud';
import { onAuthChange } from '@/features/account/runtime/authScope';
import { definitions, discoverCapabilities } from './managementCatalog';
import type { Conv } from '@/state/types';
import { S } from '@/state/store';

interface Score { id: string; relevance_probability: number }
interface Observation { direct_answer_probability: number; mode: 'observe'; requested_model: string; scores: Score[]; latency_ms: number; input_tokens: number | null; output_tokens: number | null; execution_changed: false }
type Result = Observation | { status: 'fallback'; code: string; execution_changed: false };
// A comparison question, never a registered or executable capability.
const directAnswer = { id: 'lom.personal.answer_without_tools', description: 'Answer the user directly using general knowledge or conversation only, without tools, external actions, private user data, device state, document retrieval or session history.' };
const cache = new Map<string, Promise<Result>>();
onAuthChange(() => cache.clear());
const groups: [RegExp, RegExp][] = [[/文档|document/i, /doc/], [/消息|聊天|message|chat/i, /message|chat/], [/手机|phone/i, /phone/], [/会话|任务|Codex|Claude|CLI|Lom|session|task/i, /session/], [/记忆|memory/i, /memory/]];
function candidates(query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return definitions.filter(t => t.name !== 'personal_capabilities')
    .map(t => ({ id: `lom.personal.${t.name}`, description: `${t.name}: ${t.description}`.slice(0, 240),
      rank: groups.filter(([request, tool]) => request.test(query) && tool.test(t.name)).length + words.filter(w => `${t.name} ${t.description}`.toLowerCase().includes(w)).length }))
    .sort((a,b) => b.rank - a.rank).slice(0,19);
}
function valid(value: Observation, ids: string[]) {
  return value?.mode === 'observe' && value.execution_changed === false && Array.isArray(value.scores) && value.scores.length === ids.length
    && new Set(value.scores.map(s => s.id)).size === ids.length && value.scores.every(s => ids.includes(s.id) && Number.isFinite(s.relevance_probability) && s.relevance_probability >= 0 && s.relevance_probability <= 1);
}
/** Explicit experiment: the baseline catalog is unchanged and no selected tool is executed. */
export async function observeCapabilities(self: Conv, args: Record<string, unknown>, current: () => boolean) {
  const { observe, ...queryArgs } = args;
  if (observe !== true) throw new Error('Jev 观察参数必须为 true');
  const baseline = discoverCapabilities(queryArgs);
  if (queryArgs.id || typeof queryArgs.query !== 'string' || !queryArgs.query.trim()) throw new Error('Jev 观察需要 query，不接受指定能力 ID');
  if (!current()) throw new Error('助理已停止或账号已变化');
  const query = queryArgs.query.trim();
  if (/停止|取消|进度|状态|等待|\b(stop|cancel|status|wait)\b/i.test(query))
    return { ...baseline, observation: { status: 'bypassed', reason: '确定的状态、等待和停止路径不等待 Jev', execution_changed: false } };
  const rows = candidates(query), candidateIds = rows.map(c => c.id);
  // Cache only within this account, PA, user turn, tool schema and permission snapshot.
  const key = JSON.stringify([S.account?.id, self.personalScope, self.turnId, self.messages.findLast(m => m.type === 'user')?.id, S.permission, self.personal?.id, query, definitions]);
  const prior = cache.get(key);
  const pending = prior ?? requestObservation(query, rows, candidateIds);
  if (!prior) {
    if (cache.size >= 32) cache.clear();
    cache.set(key, pending);
  }
  const value = await pending;
  if (!current()) throw new Error('助理已停止或账号已变化，未返回旧观察结果');
  return { ...baseline, observation: { ...value, cache_hit: !!prior, local_candidates: candidateIds,
    note: '仅观察候选相关性，不是执行授权；沿用原能力发现，不自动重试或重放任务。未评测端到端收益。' } };
}
async function requestObservation(query: string, rows: ReturnType<typeof candidates>, ids: string[]): Promise<Result> {
  try {
    const value = await cloud<Observation>('POST', '/v1/personal/jev/observe', { query, candidates: [...rows.map(({ id, description }) => ({ id, description })), directAnswer] }, { timeoutMs: 3500 });
    if (!valid(value, [...ids, directAnswer.id])) throw new Error('invalid_response');
    return { ...value, scores: value.scores.filter(s => s.id !== directAnswer.id),
      direct_answer_probability: value.scores.find(s => s.id === directAnswer.id)!.relevance_probability };
  } catch (e) {
    // Retain failures for this turn too: repeated discovery must not duplicate paid requests.
    return { status: 'fallback', code: e instanceof CloudError ? e.code : 'jev.invalid_response', execution_changed: false };
  }
}

/** Semantic fallback only when literal discovery found no candidates; never authorizes execution. */
export async function discoverWithJev(self: Conv, args: Record<string, unknown>, current: () => boolean) {
  const baseline = discoverCapabilities(args);
  if (args.id || !args.query || args.offset || baseline.total !== 0) return baseline;
  const result = await observeCapabilities(self, { ...args, observe: true }, current);
  const observation = result.observation;
  if (!('scores' in observation)) return result;
  const ranked = [...observation.scores].sort((a, b) => b.relevance_probability - a.relevance_probability);
  const direct = observation.direct_answer_probability;
  const routing = direct > ranked[0].relevance_probability ? 'direct_answer_suggested'
    : direct === ranked[0].relevance_probability ? 'review_required' : 'semantic_suggestions';
  // Do not send schemas for speculative matches. All scores are advisory, not a calibrated cutoff.
  const suggestions = routing === 'semantic_suggestions' ? ranked.slice(0, Math.min(Number(args.limit ?? 5), 5)).map(score => {
    const capability = discoverCapabilities({ id: score.id }).capability!;
    const { input_schema: _schema, ...summary } = capability;
    return { ...score, capability: summary, schema_lookup: { id: score.id } };
  }) : [];
  const { scores: _scores, local_candidates: _candidates, ...summary } = observation;
  return { ...result, observation: summary, suggestions, routing, candidate_count: ranked.length,
    more_candidates: suggestions.length < ranked.length,
    guidance: '建议不代表授权或完整计划；直接回答建议和同分结果需主模型核实。需要工具时用 personal_capabilities({id}) 读取 schema；可无 query 分页补查完整目录。未评测概率阈值，不自动执行或裁剪工具。' };
}
