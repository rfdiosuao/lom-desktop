import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { LOM_PROVIDER_NAME } from '@/features/account/runtime/builtin';
import { beginAuthChange } from '@/features/account/runtime/authScope';
import type { Agent } from '@/state/types';

/* ST05：手机明确选过的模型失效后必须阻止发送，不能静默改用电脑模型。
 * 只 mock 本机/网络边界，调用实际的 syncPhoneModel 解析逻辑。 */
const m = vi.hoisted(() => ({ rpc: vi.fn(), api: vi.fn(), sent: [] as Record<string, string>[] }));
vi.mock('./phoneRpc', () => ({ phoneRpc: m.rpc }));
vi.mock('@/core/client', () => ({ api: m.api }));
vi.mock('./phoneCache', () => ({ savePhoneCache: vi.fn(async () => {}) }));
vi.mock('./phoneFiles', () => ({ uploadPhoneFile: vi.fn(async () => 'file-1') }));
const { syncPhoneModel } = await import('./phoneModel');
const { sendPhone } = await import('./phoneChat');
const { phoneModelName } = await import('@/state/selectors');

const agent = (model: string): Agent => ({ id: 'dev_phone', kind: 'phone', name: '手机', persona: '', status: 'online', model });
const provider = (over: Record<string, unknown> = {}) => ({
  id: 'own', name: '自带 Key', platform: 'openai', base_url: 'https://fixture.invalid/v1',
  models: ['private-model'], enabled: true, api_key: 'BYOK_KEY', created_at: 1, ...over,
});

const cloudReady = () => {
  S.cloud = 'signed-in'; S.account = { id: 'acc', name: 'A', email: '' };
  S.providers = [{ id: 'cloud', name: LOM_PROVIDER_NAME, platform: 'openai', base_url: 'https://gw/v1', models: ['new-pro'], enabled: true, created_at: 1 }];
  S.cloudModels = { pro: 'new-pro', max: 'new-max', mini: 'new-mini' };
  m.api.mockResolvedValue([{ ...provider(), id: 'cloud', name: LOM_PROVIDER_NAME, models: ['new-pro'], api_key: 'POINTS_KEY', base_url: 'https://gw/v1' }]);
};

beforeEach(() => {
  vi.clearAllMocks();
  m.sent.length = 0;
  S.agents = {}; S.providers = []; S.cloud = 'signed-out'; S.cloudModels = null; S.account = null;
  S.cloudLegacy = {}; S.cloudAllowed = null; S.cloudExtra = []; S.conn = 'connecting';
  S.model = 'builtin::charged-model'; S.phoneModel = 'lom-mini';
  // 保存副本：syncPhoneModel 结束时会清空 payload 与读取到的 api_key。
  m.rpc.mockImplementation(async (_device: string, method: string, payload: Record<string, string>) => {
    if (method === 'model.sync') m.sent.push({ ...payload });
    return { status: 'saved' };
  });
  m.api.mockResolvedValue([provider()]);
});

const synced = () => m.sent;
const modelSyncs = () => m.rpc.mock.calls.filter(c => c[1] === 'model.sync').length;

it('ST05 供应商已删除时阻止发送，不调用电脑模型', async () => {
  S.agents = { dev_phone: agent('removed::private-model') };
  await expect(syncPhoneModel('dev_phone')).rejects.toThrow(/已失效.*重新选择/);
  expect(modelSyncs()).toBe(0);
  expect(phoneModelName(S.agents.dev_phone.model)).toBe('private-model');
});

it('ST05 供应商被禁用时阻止发送', async () => {
  S.agents = { dev_phone: agent('own::private-model') };
  S.providers = [provider({ enabled: false })];
  await expect(syncPhoneModel('dev_phone')).rejects.toThrow(/已失效.*重新选择/);
  expect(modelSyncs()).toBe(0);
});

it('ST05 模型从供应商列表中移除后阻止发送', async () => {
  S.agents = { dev_phone: agent('own::private-model') };
  S.providers = [provider({ models: ['another-model'] })];
  await expect(syncPhoneModel('dev_phone')).rejects.toThrow(/已失效.*重新选择/);
  expect(modelSyncs()).toBe(0);
});

it('ST05 内置档位不可用时阻止发送，不改成电脑的计费模型', async () => {
  S.phoneModel = 'lom-mini';
  await expect(syncPhoneModel('dev_phone')).rejects.toThrow(/Lom Mini.*已失效.*重新选择/);
  expect(modelSyncs()).toBe(0);
  expect(phoneModelName(S.phoneModel)).toBe('Lom Mini');
});

it('ST05 未选择（跟随电脑）仍可用电脑当前模型', async () => {
  S.phoneModel = '';
  S.model = 'own::private-model';
  S.providers = [provider()];
  await syncPhoneModel('dev_phone');
  expect(synced()).toEqual([{ base_url: 'https://fixture.invalid/v1', api_key: 'BYOK_KEY', model: 'private-model', platform: 'openai', revision: expect.any(String) }]);
});

it('ST05 这台手机自己的选择优先于手机默认模型', async () => {
  S.providers = [provider(), provider({ id: 'second', name: '第二家', models: ['other-model'], api_key: 'SECOND_KEY' })];
  m.api.mockResolvedValue([provider(), provider({ id: 'second', name: '第二家', models: ['other-model'], api_key: 'SECOND_KEY' })]);
  S.phoneModel = 'own::private-model';
  S.agents = { dev_phone: agent('second::other-model') };
  await syncPhoneModel('dev_phone');
  expect(synced()[0]).toMatchObject({ model: 'other-model', api_key: 'SECOND_KEY' });
});

it('ST05 有效的内置档位同步云端模型和积分计费来源', async () => {
  S.cloud = 'signed-in'; S.account = { id: 'acc', name: 'A', email: '' };
  S.providers = [{ id: 'cloud', name: LOM_PROVIDER_NAME, platform: 'openai', base_url: 'https://gw/v1', models: ['glm-4-flash'], enabled: true, created_at: 1 }];
  S.cloudModels = { pro: 'MiniMax-M3', max: 'step-5-preview', mini: 'glm-4-flash' };
  m.api.mockResolvedValue([{ ...provider(), id: 'cloud', name: LOM_PROVIDER_NAME, models: ['glm-4-flash'], api_key: 'POINTS_KEY' }]);
  S.phoneModel = 'lom-mini';
  await syncPhoneModel('dev_phone');
  expect(synced()[0]).toMatchObject({ model: 'glm-4-flash', api_key: 'POINTS_KEY' });
  expect(phoneModelName('lom-mini')).toBe('Lom Mini');
});

it.each(['lom-pro', 'cloud::old-pro'])('ST05 稳定档位/旧物理模型 %s 迁移到云端当前模型', async stored => {
  cloudReady();
  S.cloudLegacy = { pro: ['old-pro'] };
  S.phoneModel = stored;
  await syncPhoneModel('dev_phone', true);
  expect(synced()[0]).toMatchObject({ model: 'new-pro', api_key: 'POINTS_KEY' });
});

it('ST05 旧模型映射有歧义时不猜测、阻止发送', async () => {
  cloudReady();
  S.cloudLegacy = { pro: ['old-shared'], max: ['old-shared'] };
  S.phoneModel = 'cloud::old-shared';
  await expect(syncPhoneModel('dev_phone')).rejects.toThrow(/已失效.*重新选择/);
  expect(modelSyncs()).toBe(0);
  expect(S.model).toBe('builtin::charged-model');
});

it('ST05 订阅不包含的 Lom 档位按失效阻止发送，不降级到电脑模型', async () => {
  cloudReady();
  S.cloudAllowed = ['pro', 'max'];
  S.phoneModel = 'lom-mini';
  await expect(syncPhoneModel('dev_phone')).rejects.toThrow(/Lom Mini.*已失效.*重新选择/);
  expect(modelSyncs()).toBe(0);
});

it('ST05 账号在读取供应商时切换，不发送旧手机模型且清空密钥', async () => {
  let leaked: Record<string, unknown>[] = [];
  S.agents = { dev_phone: agent('own::private-model') };
  S.providers = [provider()];
  m.api.mockImplementation(async () => {
    beginAuthChange();
    leaked = [provider()];
    return leaked;
  });
  await expect(syncPhoneModel('dev_phone')).rejects.toThrow('账号已切换');
  expect(modelSyncs()).toBe(0);
  expect(leaked[0].api_key).toBe('');
});

it('ST05 相同模型配置重复同步只发送一次（指纹去重保留）', async () => {
  S.agents = { dev_phone: agent('own::private-model') };
  S.providers = [provider({ base_url: 'https://dedup.invalid/v1' })];
  /* 每次返回新对象：syncPhoneModel 会清空它读到的 api_key */
  m.api.mockImplementation(async () => [provider({ base_url: 'https://dedup.invalid/v1' })]);
  await syncPhoneModel('dev_phone');
  expect(await syncPhoneModel('dev_phone')).toEqual({ status: 'unchanged', model: 'private-model' });
  expect(modelSyncs()).toBe(1);
});

it('ST05 模型失效时手机消息不会发出', async () => {
  S.agents = { dev_phone: agent('removed::private-model') };
  const c = { id: 'st05-blocked', owner: 'dev_phone', title: '手机', updated: 1, messages: [] };
  await expect(sendPhone(c, '做点事')).rejects.toThrow(/已失效.*重新选择/);
  expect(m.rpc.mock.calls.filter(call => call[1] === 'chat.send')).toHaveLength(0);
  expect(c).not.toHaveProperty('phonePending');
});
