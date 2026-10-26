import { S, update } from '@/state/store';
import { api } from '@/core/client';
import { LOM_TIERS, resolveLomId, tierOf, type CloudModels, type LegacyModels } from './modelBinding';
import type { CoreSchedule } from '@/features/schedules/runtime/schedules';

export function mergedLegacy(next: LegacyModels = {}, previous?: CloudModels | null): LegacyModels {
  return Object.fromEntries(LOM_TIERS.map(t => [t, [...new Set([...(S.cloudLegacy[t] || []), ...(next[t] || []), ...(previous?.[t] ? [previous[t]] : [])])]]));
}
export function reconcileSelections(provider: string, models: CloudModels, legacy: LegacyModels) {
  const resolve = (id: string) => {
    if (id.startsWith(`${provider}::`) && S.cloudExtra.includes(id.slice(provider.length + 2))) return id;
    const tier = tierOf(id, provider, models, legacy);
    return tier ? `lom-${tier}` : id;
  };
  update(s => {
    s.model = resolve(s.model); s.phoneModel = resolve(s.phoneModel);
    for (const a of Object.values(s.agents)) if (a.model) a.model = resolve(a.model);
    for (const t of s.teams) for (const m of t.members) if (m.model) m.model = resolve(m.model);
    s.cloudLegacy = legacy;
  });
}
export interface ScheduleModelIssue { id: string; name: string; reason: 'model_unknown' | 'update_failed' }
/** Existing-conversation jobs inherit their owning conversation; never replace their assistant. */
export async function reconcileSchedules(provider: string, models: CloudModels, legacy: LegacyModels, isCurrent: () => boolean): Promise<ScheduleModelIssue[]> {
  const rows = await api<CoreSchedule[]>('GET', '/api/cron/jobs');
  const issues: ScheduleModelIssue[] = [];
  for (const row of rows) {
    if (!isCurrent()) return issues;
    const config = row.metadata.agent_config;
    const m = config?.model as { provider_id?: string; model?: string } | undefined;
    if (row.target?.execution_mode === 'existing' || config?.cli_path || m?.provider_id !== provider || !m.model || S.running[row.metadata.conversation_id]) continue;
    const id = resolveLomId(`${provider}::${m.model}`, provider, models, legacy, undefined, S.cloudExtra);
    const name = id.slice(provider.length + 2);
    if (!id || ![...Object.values(models), ...S.cloudExtra].includes(name)) {
      issues.push({ id: row.id, name: row.name || row.id, reason: 'model_unknown' }); continue;
    }
    if (name === m.model) continue;
    try { await migrateSchedule(row, provider, name, isCurrent); }
    catch { // A failed cron migration is reported separately, without blocking other jobs or chat.
      if (isCurrent()) issues.push({ id: row.id, name: row.name || row.id, reason: 'update_failed' });
    }
  }
  return issues;
}
async function migrateSchedule(row: CoreSchedule, provider: string, name: string, isCurrent: () => boolean) {
  const allowed = ['name', 'cli_path', 'assistant_id', 'mode', 'model_id', 'model', 'config_options', 'workspace'];
  const agent_config = { ...Object.fromEntries(Object.entries(row.metadata.agent_config || {}).filter(([k]) => allowed.includes(k))), model: { provider_id: provider, model: name } };
  await api('PUT', `/api/cron/jobs/${row.id}`, { agent_config });
  if (!isCurrent()) return;
  const confirmed = (await api<CoreSchedule[]>('GET', '/api/cron/jobs')).find(x => x.id === row.id);
  if ((confirmed?.metadata.agent_config?.model as { model?: string })?.model !== name) throw new Error('定时任务模型同步未确认，请重新同步');
  if (isCurrent()) update(s => { const local = s.schedules.find(x => x.id === row.id); if (local) local.agentConfig = confirmed?.metadata.agent_config; });
}
