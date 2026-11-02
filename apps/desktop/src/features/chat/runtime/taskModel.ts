import { authRevision } from '@/features/account/runtime/authScope';
import { S } from '@/state/store';
import { api } from '@/core/client';
import { update } from '@/state/store';
import type { Conv, ModelOption } from '@/state/types';
import type { CoreConversation } from '@/core/types';

export const modelChanges = new Set<string>();

export function recordTaskModel(c: Conv, remote: CoreConversation) {
  if (!remote.model) throw new Error('核心没有返回任务使用的模型');
  update(() => { c.providerId = remote.model!.provider_id; c.modelId = `${remote.model!.provider_id}::${remote.model!.model}`; c.lomTier = remote.extra?.lom_tier; });
}

/** 每次发送前确认凭据归属；同步失败就停止发送，绝不改用另一家的模型。 */
export async function ensureTaskModel(c: Conv, m: ModelOption) {
  if (!m.providerId || !m.model || m.unavailable) throw new Error('所选模型不可用，请重新连接或选择模型');
  const auth = authRevision(), owner = S.account?.id;
  const current = () => { if (!auth() || S.account?.id !== owner) throw new Error('账号已切换，未确认旧模型'); };
  let remote = await api<CoreConversation>('GET', `/api/conversations/${c.id}`);
  current();
  if (remote.model?.provider_id !== m.providerId || remote.model?.model !== m.model || remote.extra?.lom_tier !== m.lomTier) {
    // The core merges extra keys; snapshots returned by GET must never be resubmitted.
    remote = await api<CoreConversation>('PATCH', `/api/conversations/${c.id}`, { model: { provider_id: m.providerId, model: m.model }, ...(m.lomTier || remote.extra?.lom_tier ? { extra: { lom_tier: m.lomTier ?? null } } : {}) });
  }
  current();
  if (remote.model?.provider_id !== m.providerId || remote.model?.model !== m.model) throw new Error('模型切换未生效，已阻止发送');
  if (m.lomTier && remote.extra?.lom_tier !== m.lomTier) throw new Error('核心未确认Lom档位，已阻止发送');
  recordTaskModel(c, remote);
}
