import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { api } from '@/core/client';
import { personalError } from './errors';
vi.mock('@/core/client', async load => ({ ...await load<typeof import('@/core/client')>(), api: vi.fn() }));
vi.mock('@/features/schedules/runtime/schedules', () => ({ saveCoreSchedule: vi.fn(async (_f, _id, scope) => { scope?.beforeCreate?.(); }) }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/shared/overlays/controller', async load => ({ ...await load<object>(), toast }));
const { storeAssistant } = await import('./catalog');
const { ensureHeartbeats } = await import('./heartbeats');
const { saveCoreSchedule } = await import('@/features/schedules/runtime/schedules');
const { loadPhoneCache } = await import('@/features/phones/runtime/phoneCache');

const a = { id: 'pa_a', name: '小麓', directory: '/a', workspace: '/a', conversation: 'conv' };
const stateKey = 'lom.personal.heartbeats.v1:owner:pa_a';
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); vi.restoreAllMocks();
  S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' };
  S.convs = [{ id: 'conv', title: '', owner: 'pc', messages: [], updated: 1, modelId: 'cloud::pro', providerId: 'cloud', personal: { id: 'pa_a', name: '小麓', directory: '/a' } }];
  storeAssistant(a); vi.mocked(api).mockResolvedValue([] as never);
});

it('REFACTOR-01-M7 AC-4 默认任务记录损坏：另存原文，未经确认不创建，确认后只建服务器上没有的', async () => {
  localStorage.setItem(stateKey, '{');
  await expect(ensureHeartbeats(a)).rejects.toThrow('待核对');
  expect(saveCoreSchedule).not.toHaveBeenCalled();
  expect(localStorage.getItem(`${stateKey}.invalid`)).toBe('{');
  vi.mocked(api).mockResolvedValue([{ description: 'lom:personal-heartbeat:v1:pa_a:daily', metadata: { conversation_id: 'conv' } }] as never);
  await ensureHeartbeats(a, true);
  expect(vi.mocked(saveCoreSchedule).mock.calls.map(c => c[0].cron)).toEqual(['0 3 * * SUN', '0 9 1 * *']);
});

it('REFACTOR-01-M7 AC-5 写满时助理配置明确报未保存，提示与原来一致', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new DOMException('full', 'QuotaExceededError'); });
  let error: unknown;
  try { storeAssistant({ ...a, name: '改名' }); } catch (e) { error = e; }
  expect(personalError(error)).toBe('无法保存本机助理配置，请检查应用存储是否已满或被禁用。');
});

it('REFACTOR-01-M7 AC-6 手机缓存损坏只提示一次，原文仍保留不覆盖', () => {
  const key = 'lom.phone-cache.v1:owner';
  localStorage.setItem(key, '{');
  for (let i = 0; i < 5; i++) loadPhoneCache(); // 同步循环每 2 秒调用一次
  expect(toast.mock.calls.filter(c => String(c[0]).startsWith('phone.cache_unavailable'))).toHaveLength(1);
  expect(localStorage.getItem(key)).toBe('{');
});
