export type LomTier = 'pro' | 'max' | 'mini';
export type CloudModels = Record<LomTier, string>;
export type LegacyModels = Partial<Record<LomTier, string[]>>;
export const LOM_TIERS: LomTier[] = ['pro', 'max', 'mini'];
export function tierOf(id: string, provider: string, models: CloudModels, legacy: LegacyModels = {}): LomTier | undefined {
  const alias = /^lom-(pro|max|mini)$/.exec(id)?.[1] as LomTier | undefined;
  if (alias) return alias;
  if (!id.startsWith(`${provider}::`)) return;
  const physical = id.slice(provider.length + 2);
  const hits = LOM_TIERS.filter(t => models[t] === physical || legacy[t]?.includes(physical));
  return hits.length === 1 ? hits[0] : undefined;
}
export function resolveLomId(id: string, provider: string, models: CloudModels, legacy: LegacyModels = {}, tier?: LomTier, extra: string[] = []): string {
  if (!id.startsWith(`${provider}::`) && !/^lom-(pro|max|mini)$/.test(id)) return id;
  if (!tier && id.startsWith(`${provider}::`) && extra.includes(id.slice(provider.length + 2))) return id;
  const selected = tier || tierOf(id, provider, models, legacy);
  if (selected && models[selected]) return `${provider}::${models[selected]}`;
  const physical = id.slice(provider.length + 2);
  return LOM_TIERS.some(t => models[t] === physical || legacy[t]?.includes(physical)) ? '' : id;
}
