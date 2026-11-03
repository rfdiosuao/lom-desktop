import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', async load => ({ ...await load<object>(), api: m.api }));
vi.mock('@/features/account/runtime/cloud', async load => ({ ...await load<object>(), ensureLomSelection: vi.fn(async () => undefined) }));
import { S } from '@/state/store';
import type { Schedule } from '@/state/types';
import { resolveScheduleModel, scheduleModelProblem } from './scheduleConfig';
import { saveCoreSchedule, toggleCoreSchedule } from './schedules';

const job = (o: Partial<Schedule> = {}): Schedule => ({
  id: 'job', name: '日报', prompt: '整理日报', exec: 'pc', freq: 'daily', time: '09:00', days: [], every: 60, runIn: 'new', enabled: false,
  last: null, runs: [], remote: true, runMode: 'auto_edit', agentConfig: { name: '电脑主控', assistant_id: 'lom', mode: 'auto_edit', model: { provider_id: 'cloud', model: 'shared' } }, ...o,
});
const puts = () => m.api.mock.calls.filter(c => c[0] === 'PUT');
beforeEach(() => {
  vi.clearAllMocks(); m.api.mockResolvedValue([]);
  S.cloud = 'signed-in'; S.account = { id: 'acc', name: '', email: '' }; S.cloudAllowed = null; S.cloudExtra = [];
  S.providers = [{ id: 'cloud', name: 'Lom 云端', enabled: true, models: ['shared', 'mini'] } as never];
  // Pro 与 Max 共用一个物理模型：只存物理模型的任务无法区分档位
  S.cloudModels = { pro: 'shared', max: 'shared', mini: 'mini' }; S.cloudLegacy = {};
});

it('REFACTOR-01-M6 AC-1 共用物理模型的任务能解析、能编辑，不被误报失效', async () => {
  expect(resolveScheduleModel(job())).toMatchObject({ providerId: 'cloud', model: 'shared' });
  expect(scheduleModelProblem(job())).toBeUndefined();
  await saveCoreSchedule(job({ runMode: 'default' }), 'job');
  expect(puts()[0]).toEqual(['PUT', '/api/cron/jobs/job', expect.objectContaining({ agent_config: expect.objectContaining({ model: { provider_id: 'cloud', model: 'shared' }, mode: 'default' }) })]);
});

it('REFACTOR-01-M6 AC-2 模型已删除的任务不能启用，核心不被调用', async () => {
  const dead = job({ agentConfig: { name: '电脑主控', model: { provider_id: 'deleted', model: 'gone' } } });
  expect(scheduleModelProblem(dead)).toBe('定时任务模型已失效，请编辑任务重新选择模型');
  await expect(toggleCoreSchedule(dead)).rejects.toThrow('已失效');
  expect(puts()).toEqual([]);
});

it('REFACTOR-01-M6 AC-3 暂停总是允许，模型失效也能暂停', async () => {
  const dead = job({ enabled: true, agentConfig: { model: { provider_id: 'deleted', model: 'gone' } } });
  await toggleCoreSchedule(dead);
  expect(puts()).toEqual([['PUT', '/api/cron/jobs/job', { enabled: false }]]);
});

it('REFACTOR-01-M6 AC-4 外部 Agent 和未记录模型的旧任务不按 Lom 模型拦截', async () => {
  await toggleCoreSchedule(job({ agentConfig: { cli_path: '/usr/local/bin/codex', model: { provider_id: 'x', model: 'y' } } }));
  await toggleCoreSchedule(job({ agentConfig: { name: '电脑主控' } }));
  expect(puts()).toHaveLength(2);
});

it('REFACTOR-01-M6 AC-5 档位换了物理模型：旧任务按档位映射到新模型', () => {
  S.cloudModels = { pro: 'pro-v2', max: 'max', mini: 'mini' }; S.cloudLegacy = { pro: ['pro-v1'] };
  const legacy = job({ agentConfig: { model: { provider_id: 'cloud', model: 'pro-v1' } } });
  expect(resolveScheduleModel(legacy)).toMatchObject({ model: 'pro-v2', lomTier: 'pro' });
  expect(scheduleModelProblem(legacy)).toBeUndefined();
});
