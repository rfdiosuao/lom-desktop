import { beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import { pcModels } from '@/state/selectors';
const api = vi.fn();
vi.mock('@/core/client', () => ({ api: (...args: unknown[]) => api(...args) }));
vi.mock('./providerSync', () => ({ refreshProviders: vi.fn() }));
const { deleteProvider } = await import('./providers');
beforeEach(() => {
  api.mockReset();
  update(s => {
    s.providers = [{ id: 'cloud', name: 'Lom 云端', platform: 'openai', base_url: '', enabled: true, models: ['pro'], created_at: 0 }];
    s.cloudModels = { pro: 'pro', max: 'max', mini: 'mini' };
    s.cloud = 'signed-out'; s.account = null;
  });
});
it('内置模型拒绝删除，不向核心发删除请求', async () => {
  await expect(deleteProvider('cloud')).rejects.toThrow('不能删除');
  expect(api).not.toHaveBeenCalled();
  expect(S.providers).toHaveLength(1);
});
it('退出登录后，即使旧核心配置仍启用，云端模型也不能被选择', () => {
  expect(pcModels().slice(0, 3).every(m => m.unavailable && !m.providerId)).toBe(true);
});
it('没有任何核心配置时仍显示三档内置模型', () => {
  update(s => { s.providers = []; });
  expect(pcModels().map(m => m.name)).toEqual(['Lom Pro', 'Lom Max', 'Lom Mini']);
});
