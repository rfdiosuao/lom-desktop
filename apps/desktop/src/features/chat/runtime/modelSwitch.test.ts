import { beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { Conv } from '@/state/types';
import { usableModel } from './modelFallback';
import { deferSwitch, pendingSwitch, setSwitchApplier } from './deferredSwitch';

const lom = { id: 'cloud', name: 'Lom 云端', enabled: true, models: ['max-2', 'pro-2'] };
const conv = (extra: Partial<Conv>): Conv => ({ id: 'c1', owner: 'pc', title: 't', updated: 1, messages: [], remote: true, ...extra } as Conv);

beforeEach(() => {
  S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' };
  S.providers = [lom as never, { id: 'own', name: '我的 Key', enabled: true, models: ['gpt'] } as never];
  S.cloudModels = { pro: 'pro-2', max: 'max-2', mini: '' } as never; S.cloudAllowed = null; S.running = {};
});

it('D36 when the server retires a Lom model, the task quietly moves to an available Lom model of the same tier', () => {
  // 服务器把 max 档从 max-1 换成了 max-2：任务记着的 max-1 已经不在
  const c = conv({ modelId: 'cloud::max-1', providerId: 'cloud', lomTier: 'max' });
  expect(usableModel(c, undefined)).toMatchObject({ model: 'max-2', lomTier: 'max' });
  // 同档位没了就退到其他可用档位
  S.cloudModels = { pro: 'pro-2', max: '', mini: '' } as never;
  expect(usableModel(c, undefined)).toMatchObject({ lomTier: 'pro' });
});

it('D36 a task on the user\'s own key is never silently switched to paid Lom credits', () => {
  const c = conv({ modelId: 'own::gpt-old', providerId: 'own' });
  expect(usableModel(c, undefined)).toBeUndefined();
  const ok = { id: 'own::gpt', name: 'gpt', providerId: 'own', model: 'gpt', byok: true };
  expect(usableModel(c, ok as never)).toBe(ok);
});

it('D36 a model or effort picked mid-turn is applied right after the turn ends; the later pick wins', async () => {
  const applied: unknown[] = [];
  setSwitchApplier(async (id, change) => { applied.push([id, change]); });
  update(s => { s.running.c1 = true; });
  deferSwitch('c1', { model: 'cloud::pro-2' }, 'Lom Pro');
  deferSwitch('c1', { effort: 'high' }, '推理强度 高');
  deferSwitch('c1', { model: 'cloud::max-2' }, 'Lom Max');
  expect(S.toast?.text).toContain('这一轮结束后切换到「Lom Max」');
  update();
  expect(applied).toEqual([]);
  update(s => { delete s.running.c1; });
  await vi.waitFor(() => expect(applied).toEqual([['c1', { model: 'cloud::max-2', effort: 'high' }]]));
  expect(pendingSwitch('c1')).toBeUndefined();
});

it('D36 picking a model while the task is running queues it instead of refusing', async () => {
  const { applyModelToTask } = await import('./tasks');
  S.convs = [conv({ modelId: 'cloud::pro-2', providerId: 'cloud', lomTier: 'pro' })];
  update(s => { s.running.c1 = true; });
  expect(await applyModelToTask('c1', 'cloud::max-2')).toBe(false);
  expect(pendingSwitch('c1')).toEqual({ model: 'cloud::max-2' });
  expect(S.toast?.text).not.toContain('请先停止');
});
