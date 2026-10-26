import { LOM_PROVIDER_NAME } from '@/features/account/runtime/builtin';
import { pcModels } from '@/state/selectors';
import { S } from '@/state/store';
import type { Conv, ModelOption } from '@/state/types';

/* ===== D36：服务器那边换了模型，客户端不报错 =====
 * 在服务器后台调整 Lom 模型（下线、改名、换档位映射）后，任务原来选的模型可能已经不存在。
 * 原来用的是 Lom 账号模型时，自动改用仍可用的 Lom 模型（优先同一档位），并告诉用户；
 * 用自己 Key 的模型不会被悄悄换成按积分扣费的 Lom 模型。 */

const lomProvider = () => S.providers.find(p => p.name === LOM_PROVIDER_NAME)?.id;

/** 这个任务原本用的是 Lom 账号模型（档位或 Lom 服务里的具体模型） */
export function usesLomModel(c: Conv) {
  const id = c.modelId || '';
  const provider = lomProvider();
  return !!c.lomTier || /^lom-(pro|max|mini)$/.test(id) || (!!provider && (c.providerId === provider || id.startsWith(`${provider}::`)));
}

/** 原模型还能用就原样返回；不能用且原来是 Lom 模型时，返回同档位优先的可用 Lom 模型 */
export function usableModel(c: Conv, selected: ModelOption | undefined): ModelOption | undefined {
  if (selected && !selected.unavailable) return selected;
  if (!usesLomModel(c) && c.modelId) return undefined;
  const available = pcModels().filter(m => !m.unavailable && !m.byok && m.lomTier);
  const tier = c.lomTier || /^lom-(pro|max|mini)$/.exec(c.modelId || '')?.[1];
  return available.find(m => m.lomTier === tier) ?? available.find(m => m.lomTier === 'max') ?? available[0];
}
