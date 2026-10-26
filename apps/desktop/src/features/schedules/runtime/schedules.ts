import { authAccount } from '@/features/account/runtime/authScope';
import { personalConversation } from '@/features/personal/runtime/catalog';
import { convFromCore } from '@/features/chat/runtime/history';
import type { CoreConversation } from '@/core/types';
import { api } from '@/core/client';
import { S, update } from '@/state/store';
import { currentPcModel, modelChoice } from '@/state/selectors';
import type { Schedule } from '@/state/types';
import { ensureLomSelection } from '@/features/account/runtime/cloud';
import { quietError } from '@/shared/overlays/controller';

// Wire shape: lom-core/crates/aionui-api-types/src/cron.rs.
export type CronTime = { kind: 'at'; at_ms: number; description?: string } | { kind: 'every'; every_ms: number; description?: string } | { kind: 'cron'; expr: string; tz?: string; description?: string };
export interface CoreSchedule {
  id: string; name: string; description?: string; enabled: boolean; schedule: CronTime;
  target: { payload: { text: string }; execution_mode?: string };
  metadata: { conversation_id: string; created_by: string; agent_config?: Record<string, unknown> };
  state: { next_run_at_ms?: number; last_run_at_ms?: number; last_status?: string; last_error?: string; run_count: number };
}
/* D35：lom-core 用的 cron 0.15 按 Quartz 计星期（1 = 周日 … 7 = 周六），和标准 cron（0 = 周日）的数字对不上：
 * 写 0 直接被拒，写 1 想要周一实际在周日跑。所以星期一律写英文缩写，两边含义一致；界面里 0 = 周日 … 6 = 周六。 */
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAY = '(?:[0-6]|SUN|MON|TUE|WED|THU|FRI|SAT)';
const SIMPLE = new RegExp(`^(\\d{1,2})\\s+(\\d{1,2})\\s+\\*\\s+\\*\\s+(\\*|${DAY}(?:,${DAY})*)$`, 'i');
const dayIndex = (d: string) => /^\d$/.test(d) ? Number(d) : DOW.indexOf(d.toUpperCase());

/** 界面创建的「每天 / 每周」会存成 `分 时 * * *` / `分 时 * * MON,WED`；读回来时还原成对应选项，其他表达式保持自定义 */
export function simpleCron(expr: string): { freq: 'daily' | 'weekly'; time: string; days: number[] } | null {
  const m = SIMPLE.exec(expr.trim());
  if (!m) return null;
  const min = Number(m[1]), hour = Number(m[2]);
  if (min > 59 || hour > 23) return null;
  const time = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  return m[3] === '*' ? { freq: 'daily', time, days: [] } : { freq: 'weekly', time, days: [...new Set(m[3].split(',').map(dayIndex))] };
}

/** 早期按数字写的每周任务（`* * 1,3` 本意周一、周三）：返回改用英文缩写的表达式；不需要改的返回 null */
export function namedWeekly(expr: string) {
  const simple = simpleCron(expr);
  if (simple?.freq !== 'weekly' || !/\d$/.test(expr.trim())) return null;
  const [min, hour] = expr.trim().split(/\s+/);
  return `${min} ${hour} * * ${simple.days.map(d => DOW[d]).join(',')}`;
}

export function scheduleFromCore(x: CoreSchedule): Schedule {
  const t = x.schedule;
  const simple = t.kind === 'cron' ? simpleCron(t.expr) : null;
  return { id: x.id, name: x.name, exec: 'pc', prompt: x.target.payload.text,
    freq: t.kind === 'every' ? 'interval' : t.kind === 'at' ? 'once' : simple ? simple.freq : 'custom',
    time: t.kind === 'at' ? new Date(t.at_ms - new Date(t.at_ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : simple ? simple.time : '',
    days: simple ? simple.days : [], every: t.kind === 'every' ? t.every_ms / 60000 : 60,
    runMode: typeof x.metadata.agent_config?.mode === 'string' ? (x.metadata.agent_config.mode as string) : undefined,
    runIn: x.target.execution_mode === 'existing' ? 'same' : 'new', enabled: x.enabled, auto: x.metadata.created_by === 'agent',
    last: x.state.last_run_at_ms ?? null, runs: x.state.last_run_at_ms ? [{ at: x.state.last_run_at_ms, ok: x.state.last_status === 'ok', note: x.state.last_error || x.state.last_status }] : [],
    remote: true, conversationId: x.metadata.conversation_id, cron: t.kind === 'cron' ? t.expr : '',
    timezone: t.kind === 'cron' ? t.tz : undefined, scheduleDescription: t.description,
    nextRun: x.state.next_run_at_ms, agentConfig: x.metadata.agent_config,
  };
}
export async function refreshSchedules(current?: () => boolean) {
  const rows = await api<CoreSchedule[]>('GET', '/api/cron/jobs');
  if (current && !current()) return;
  // D35：把早期按数字写的每周任务改成英文缩写，否则会提前一天执行
  for (const row of rows) {
    const expr = row.schedule.kind === 'cron' ? namedWeekly(row.schedule.expr) : null;
    if (!expr || row.schedule.kind !== 'cron') continue;
    const schedule = { ...row.schedule, expr };
    try { await api('PUT', `/api/cron/jobs/${row.id}`, { schedule }); row.schedule = schedule; }
    catch (e) { console.warn('schedules.weekday_fix_failed', e); }
  }
  update(s => { s.schedules = [...rows.map(scheduleFromCore), ...s.schedules.filter(x => !x.remote && x.exec !== 'pc')]; });
}
export async function syncSchedules() {
  try { await refreshSchedules(); } catch (e) { quietError('sync.schedules_failed', e); }
}
export function scheduleTime(f: Schedule): CronTime {
  if (f.freq === 'once') {
    const at_ms = new Date(f.time).getTime();
    if (!Number.isFinite(at_ms) || at_ms <= Date.now()) throw new Error('请选择未来的执行时间');
    return { kind: 'at', at_ms };
  }
  if (f.freq === 'interval') {
    const every_ms = Number(f.every) * 60000;
    if (!Number.isFinite(every_ms) || every_ms <= 0) throw new Error('间隔必须大于零');
    return { kind: 'every', every_ms };
  }
  if (f.freq === 'custom') return { kind: 'cron', expr: f.cron || '', tz: f.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone };
  const [h, m] = f.time.split(':').map(Number);
  if (!Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(m) || m < 0 || m > 59) throw new Error('请选择有效时间');
  if (f.freq === 'weekly' && !f.days.length) throw new Error('至少选择一天');
  return { kind: 'cron', expr: `${m} ${h} * * ${f.freq === 'weekly' ? f.days.map(d => DOW[d]).join(',') : '*'}`, tz: f.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone };
}
type PersonalScheduleScope = { personalId: string; beforeCreate?: () => void };
function scheduleGuard(f: Schedule, scope?: PersonalScheduleScope, checkModel = true) {
  const current = authAccount();
  return () => {
    if (scope) {
      if (!current()) throw new Error('账号已切换，未继续操作定时任务');
      const c = personalConversation(`personal:${scope.personalId}`);
      if (!c || c.id !== f.conversationId) throw new Error('助理会话归属不一致');
      const selected = f.agentConfig?.model as { provider_id?: string; model?: string } | undefined;
      const choice = selected ? modelChoice(`${selected.provider_id}::${selected.model}`) : modelChoice(c.modelId || '');
      if (checkModel && (!choice?.model || choice.byok || choice.unavailable)) throw new Error('个人助理只能使用可用的Lom账号模型');
    }
  };
}
export async function saveCoreSchedule(f: Schedule, id?: string, scope?: PersonalScheduleScope) {
  const current = scope ? authAccount() : undefined;
  const guard = scheduleGuard(f, scope); guard();
  const selected = f.agentConfig?.model as { provider_id?: string; model?: string } | undefined;
  await ensureLomSelection(selected?.provider_id && selected.model ? `${selected.provider_id}::${selected.model}` : S.model);
  guard();
  const body = { name: f.name.trim(), message: f.prompt.trim(), schedule: scheduleTime(f), execution_mode: f.runIn === 'same' ? 'existing' : 'new_conversation' };
  const mode = f.runMode || DEFAULT_RUN_MODE;
  if (id) {
    /* 改了运行权限时带上完整的 Agent 配置（更新接口会整体替换它） */
    const prev = f.agentConfig ? { ...f.agentConfig } : undefined;
    if (prev && selected?.provider_id && selected.model && !prev.cli_path) {
      const choice = modelChoice(`${selected.provider_id}::${selected.model}`);
      if (!choice?.model || choice.unavailable) throw new Error('定时任务模型已失效，请重新选择');
      prev.model = { provider_id: choice.providerId, model: choice.model };
    }
    const agent_config = prev && (prev.mode !== mode || JSON.stringify(prev.model) !== JSON.stringify(selected)) ? { ...pickAgentConfig(prev), mode } : undefined;
    await api('PUT', `/api/cron/jobs/${id}`, { ...body, enabled: f.enabled, ...(agent_config ? { agent_config } : {}) });
  } else {
    const previous = f.agentConfig?.model as { provider_id?: string; model?: string } | undefined;
    const model = previous ? modelChoice(`${previous.provider_id}::${previous.model}`) : currentPcModel();
    if (!model?.providerId || !model.model || model.unavailable) throw new Error('请先选择可用模型');
    const assistants = await api<{ id: string; enabled: boolean; agent?: { type: string } }[]>('GET', '/api/assistants');
    guard();
    const assistant = assistants.find(x => x.enabled && x.agent?.type === 'aionrs');
    if (!assistant) throw new Error('没有可用的电脑 Agent');
    const conversationId = f.conversationId || S.activeConv || '';
    if (f.runIn === 'same' && !conversationId) throw new Error('请先打开一个会话，或选择新开窗口');
    scope?.beforeCreate?.();
    const row = await api<CoreSchedule>('POST', '/api/cron/jobs', { ...body, ...(scope && f.scheduleDescription?.startsWith('lom:personal-heartbeat:') ? { description: f.scheduleDescription } : {}), conversation_id: conversationId, created_by: 'user',
      agent_config: { name: typeof f.agentConfig?.name === 'string' ? f.agentConfig.name : '电脑主控', assistant_id: assistant.id, model: { provider_id: model.providerId, model: model.model }, mode, ...((typeof f.agentConfig?.workspace === 'string' ? f.agentConfig.workspace : S.folder) ? { workspace: typeof f.agentConfig?.workspace === 'string' ? f.agentConfig.workspace : S.folder } : {}) } });
    guard();
    if (!f.enabled) {
      try { await api('PUT', `/api/cron/jobs/${row.id}`, { enabled: false }); }
      catch (e) { await refreshSchedules(current); throw new Error(`任务已创建，但暂停失败：${e instanceof Error ? e.message : String(e)}`); }
    }
  }
  guard();
  await refreshSchedules(current);
}
/** 定时任务通常在无人值守时运行，默认自动编辑文件（运行命令仍需确认）；「每次询问」会停在确认上等人回来 */
export const DEFAULT_RUN_MODE = 'auto_edit';

/** 更新接口接受的 Agent 配置字段（lom-core CronAgentConfigWriteDto） */
const AGENT_CONFIG_KEYS = ['name', 'cli_path', 'assistant_id', 'mode', 'model_id', 'model', 'config_options', 'workspace'];
function pickAgentConfig(c: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(c).filter(([k, v]) => AGENT_CONFIG_KEYS.includes(k) && v !== undefined && v !== null));
}

export async function toggleCoreSchedule(x: Schedule, scope?: PersonalScheduleScope) {
  const current = scope ? authAccount() : undefined;
  const guard = scheduleGuard(x, scope, !x.enabled); guard();
  await api('PUT', `/api/cron/jobs/${x.id}`, { enabled: !x.enabled });
  guard();
  await refreshSchedules(current);
}
export async function deleteCoreSchedule(id: string) {
  await api('DELETE', `/api/cron/jobs/${id}`); await refreshSchedules();
}
export async function runCoreSchedule(id: string) {
  const result = await api<{ conversation_id: string }>('POST', `/api/cron/jobs/${id}/run`, {});
  await refreshSchedules(); return result.conversation_id;
}

export async function scheduleResult(id: string) {
  const rows = await api<CoreConversation[]>('GET', `/api/cron/jobs/${id}/conversations`);
  const row = rows.sort((a, b) => (b.modified_at || b.created_at) - (a.modified_at || a.created_at))[0];
  if (!row) return null;
  update(s => { if (!s.convs.some(c => c.id === row.id)) s.convs.unshift(convFromCore(row)); });
  return row.id;
}
