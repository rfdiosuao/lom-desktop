import { beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { Schedule } from '@/state/types';
const api = vi.fn();
vi.mock('@/core/client', () => ({ api: (...args: unknown[]) => api(...args) }));
const { refreshSchedules, scheduleFromCore, scheduleTime, saveCoreSchedule, toggleCoreSchedule } = await import('./schedules');
const row = { id: 'real', name: '每日提醒', enabled: true, schedule: { kind: 'cron' as const, expr: '15 9 * * *', tz: 'Asia/Taipei', description: '每天 9:15' }, target: { payload: { text: '提醒喝水' }, execution_mode: 'existing' }, metadata: { conversation_id: 'task', created_by: 'agent' }, state: { last_run_at_ms: 100, last_status: 'ok', run_count: 1 } };
beforeEach(() => { api.mockReset(); });
it('D-SCHEDULE 真实 Agent 任务替换电脑演示，保留手机演示并标明来源', async () => {
  update(s => { s.schedules = [{ id: 'demo-pc', exec: 'pc' }, { id: 'demo-phone', exec: 'p1' }] as Schedule[]; });
  api.mockResolvedValue([row]); await refreshSchedules();
  expect(S.schedules.map(x => x.id)).toEqual(['real', 'demo-phone']);
  expect(S.schedules[0]).toMatchObject({ remote: true, auto: true, conversationId: 'task', runs: [{ at: 100, ok: true, note: 'ok' }] });
});
it('D-SCHEDULE 未改时间保存时保留 Cron 表达式和时区', async () => {
  api.mockResolvedValueOnce(row).mockResolvedValueOnce([row]);
  await saveCoreSchedule(scheduleFromCore(row), row.id);
  expect(api).toHaveBeenCalledWith('PUT', '/api/cron/jobs/real', expect.objectContaining({ schedule: { kind: 'cron', expr: '15 9 * * *', tz: 'Asia/Taipei' }, execution_mode: 'existing' }));
});
it('D-SCHEDULE 暂停失败不改变本地状态', async () => {
  const x = scheduleFromCore(row); api.mockRejectedValue(new Error('offline'));
  await expect(toggleCoreSchedule(x)).rejects.toThrow('offline'); expect(x.enabled).toBe(true);
});
it('D-SCHEDULE 错误时间被拦截而不是偷偷改为默认值', () => {
  const x = scheduleFromCore(row);
  expect(() => scheduleTime({ ...x, freq: 'interval', every: 0 })).toThrow('间隔');
  expect(() => scheduleTime({ ...x, freq: 'once', time: '2000-01-01T00:00' })).toThrow('未来');
  expect(() => scheduleTime({ ...x, freq: 'weekly', days: [], time: '09:00' })).toThrow('至少');
});

it('D-SCHEDULE 界面建的每天 / 每周任务读回来仍是每天 / 每周，复杂表达式保持自定义', async () => {
  const { simpleCron } = await import('./schedules');
  expect(simpleCron('0 9 * * *')).toEqual({ freq: 'daily', time: '09:00', days: [] });
  expect(simpleCron('30 18 * * 1,3,5')).toEqual({ freq: 'weekly', time: '18:30', days: [1, 3, 5] });
  expect(simpleCron('0 9 * * 1-5')).toBeNull();
  expect(simpleCron('*/5 * * * *')).toBeNull();
  const daily = scheduleFromCore({ ...row, schedule: { kind: 'cron', expr: '0 9 * * *', tz: Intl.DateTimeFormat().resolvedOptions().timeZone } });
  expect(daily).toMatchObject({ freq: 'daily', time: '09:00' });
  const weekly = scheduleFromCore({ ...row, schedule: { kind: 'cron', expr: '0 8 * * 1,2', tz: 'Asia/Taipei' } });
  expect(weekly).toMatchObject({ freq: 'weekly', time: '08:00', days: [1, 2] });
  // 保存时还原成同一个表达式和时区
  expect(scheduleTime(weekly)).toEqual({ kind: 'cron', expr: '0 8 * * MON,TUE', tz: 'Asia/Taipei' });
});

it('D-SCHEDULE 新建电脑任务默认「自动编辑文件」，修改运行权限时带上完整 Agent 配置', async () => {
  update(s => {
    s.providers = [{ id: 'p1', platform: 'openai', name: 'DeepSeek', base_url: 'x', models: ['deepseek-chat'], enabled: true, created_at: 0 }];
    s.model = 'p1::deepseek-chat';
  });
  api.mockImplementation((method: string, path: string) => Promise.resolve(
    path === '/api/assistants' ? [{ id: 'a1', enabled: true, agent: { type: 'aionrs' } }] : method === 'GET' ? [] : { ...row, id: 'new' }));
  const base = { ...scheduleFromCore(row), conversationId: '', remote: false, agentConfig: undefined, runMode: undefined, runIn: 'new' as const, freq: 'daily' as const, time: '09:00' };
  await saveCoreSchedule(base);
  const create = api.mock.calls.find(c => c[0] === 'POST' && c[1] === '/api/cron/jobs');
  expect(create?.[2].agent_config).toMatchObject({ assistant_id: 'a1', mode: 'auto_edit', model: { provider_id: 'p1', model: 'deepseek-chat' } });

  api.mockReset(); api.mockResolvedValue([]);
  const existing = { ...scheduleFromCore({ ...row, metadata: { ...row.metadata, agent_config: { name: '电脑主控', assistant_id: 'a1', mode: 'default', extra_field: 1 } } }) };
  await saveCoreSchedule({ ...existing, runMode: 'yolo' }, existing.id);
  expect(api.mock.calls[0][2].agent_config).toEqual({ name: '电脑主控', assistant_id: 'a1', mode: 'yolo' });
  api.mockReset(); api.mockResolvedValue([]);
  await saveCoreSchedule(existing, existing.id);
  expect(api.mock.calls[0][2].agent_config).toBeUndefined();
});

it('MODEL-SYNC-01 editing a stale cron form cannot restore its retired model', async () => {
  S.providers = [{ id: 'cloud', name: 'Lom 云端', models: ['new'], enabled: true }] as typeof S.providers;
  S.cloud = 'signed-in'; S.account = { id: 'a', name: 'A', email: '' }; S.cloudAllowed = null;
  S.cloudModels = { pro: 'new', max: 'max', mini: 'mini' }; S.cloudLegacy = { pro: ['old'] }; S.cloudExtra = [];
  api.mockResolvedValue([]);
  const f = scheduleFromCore({ ...row, metadata: { ...row.metadata, agent_config: { model: { provider_id: 'cloud', model: 'old' }, mode: 'default', workspace: '/keep' } } });
  await saveCoreSchedule({ ...f, runMode: 'yolo' }, f.id);
  expect(api.mock.calls.find(c => c[0] === 'PUT')?.[2].agent_config).toEqual({ model: { provider_id: 'cloud', model: 'new' }, mode: 'yolo', workspace: '/keep' });
});

it('D35 weekly days are written as names the core reads the same way (core counts 1 as Sunday)', async () => {
  const { simpleCron, namedWeekly } = await import('./schedules');
  const base = scheduleFromCore(row);
  // 界面：0 = 周日，1 = 周一
  expect(scheduleTime({ ...base, freq: 'weekly', time: '09:00', days: [0, 1], timezone: 'Asia/Taipei' })).toEqual({ kind: 'cron', expr: '0 9 * * SUN,MON', tz: 'Asia/Taipei' });
  expect(simpleCron('0 9 * * SUN,MON')).toEqual({ freq: 'weekly', time: '09:00', days: [0, 1] });
  // 早期数字写法：本意周一、周三，改写成缩写；已是缩写或每天的不动
  expect(namedWeekly('30 18 * * 1,3')).toBe('30 18 * * MON,WED');
  expect(namedWeekly('0 3 * * 0')).toBe('0 3 * * SUN');
  expect(namedWeekly('0 3 * * SUN')).toBeNull();
  expect(namedWeekly('0 9 * * *')).toBeNull();
  expect(namedWeekly('0 9 1 * *')).toBeNull();
});

it('D35 existing weekly tasks written with numbers are rewritten so they stop running a day early', async () => {
  const weekly = { ...row, id: 'weekly', schedule: { kind: 'cron' as const, expr: '0 8 * * 1', tz: 'Asia/Taipei' } };
  api.mockImplementation(async (method: string) => method === 'GET' ? [row, weekly] : {});
  await refreshSchedules();
  expect(api).toHaveBeenCalledWith('PUT', '/api/cron/jobs/weekly', { schedule: { kind: 'cron', expr: '0 8 * * MON', tz: 'Asia/Taipei' } });
  expect(api.mock.calls.filter(c => c[0] === 'PUT')).toHaveLength(1);
  expect(S.schedules.find(x => x.id === 'weekly')).toMatchObject({ freq: 'weekly', days: [1], cron: '0 8 * * MON' });
});
