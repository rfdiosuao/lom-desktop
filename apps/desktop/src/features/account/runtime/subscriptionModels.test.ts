import { expect, it } from 'vitest';
import { update } from '@/state/store';
import { pcModels } from '@/state/selectors';
import { MENUS } from '@/app/overlays/menu-registry';

/* 订阅里后台勾选的星钥模型：出现在模型菜单的「订阅包含」，走 Lom 云端、按积分扣 */
it('subscription extra models are listed under their own group and use the Lom cloud provider', () => {
  update(s => {
    s.cloud = 'signed-in'; s.account = { id: 'a', name: 'a', email: '' };
    s.providers = [{ id: 'cloud', platform: 'openai', name: 'Lom 云端', base_url: '', models: ['MiniMax-M3', 'step-5-preview', 'glm-4-flash', 'deepseek-v4-flash'], enabled: true, created_at: 1 },
      { id: 'own', platform: 'openai', name: 'DeepSeek', base_url: '', models: ['deepseek-chat'], enabled: true, created_at: 1 }];
    s.cloudModels = { pro: 'MiniMax-M3', max: 'step-5-preview', mini: 'glm-4-flash' };
    s.cloudExtra = ['deepseek-v4-flash'];
  });
  const extra = pcModels().find(m => m.model === 'deepseek-v4-flash');
  expect(extra).toMatchObject({ id: 'cloud::deepseek-v4-flash', providerId: 'cloud', cost: '按积分扣费' });
  const headers = MENUS.model({}).filter(x => x !== '-' && x.header).map(x => (x as { label: string }).label);
  expect(headers).toEqual(expect.arrayContaining(['Lom 内置', '订阅包含', '自带 Key']));
  update(s => { s.cloudExtra = []; });
  expect(pcModels().some(m => m.model === 'deepseek-v4-flash')).toBe(false);
});
