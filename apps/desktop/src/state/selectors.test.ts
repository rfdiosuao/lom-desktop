import { describe, expect, it } from 'vitest';
import { LOM_PROVIDER_NAME } from '@/features/account/runtime/cloud';
import { currentPcModel, modelChoice, pcModels, quotaLeft } from './selectors';
import { update } from './store';

describe('S04-01 模型菜单里的 Lom 云端三档', () => {
  it('S04-01 未登录：三档显示为不可选，并提示登录后可用', () => {
    const tiers = pcModels().slice(0, 3);
    expect(tiers.map(m => m.name)).toEqual(['Lom Pro', 'Lom Max', 'Lom Mini']);
    expect(tiers.every(m => m.unavailable && m.cost.includes('登录'))).toBe(true);
    expect(currentPcModel()).toBeUndefined();
    expect(quotaLeft()).toBeNull();
  });

  it('S04-01 登录后：三档对应网关模型，默认选 Lom Pro；自带 Key 的模型照常列出', () => {
    update(s => {
      s.cloud = 'signed-in'; s.account = { id: 'a', name: '昵称', email: '' };
      s.providers = [
        { id: 'p_cloud', platform: 'openai', name: LOM_PROVIDER_NAME, base_url: 'https://gw/v1', models: ['MiniMax-M3', 'step-5-preview', 'glm-4-flash'], enabled: true, created_at: 0 },
        { id: 'p_own', platform: 'openai', name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', models: ['deepseek-chat'], enabled: true, created_at: 0 },
      ];
      s.cloudModels = { pro: 'MiniMax-M3', max: 'step-5-preview', mini: 'glm-4-flash' };
      s.points = { total: 300, free: 300, paid: 0, period: '2026-10' };
    });
    const all = pcModels();
    expect(all.slice(0, 3).map(m => [m.name, m.model, m.unavailable ?? false])).toEqual([
      ['Lom Pro', 'MiniMax-M3', false], ['Lom Max', 'step-5-preview', false], ['Lom Mini', 'glm-4-flash', false],
    ]);
    expect(all.slice(3).map(m => m.name)).toEqual(['deepseek-chat']);
    expect(currentPcModel()?.name).toBe('Lom Pro');
    expect(quotaLeft()).toBe(300);
  });
});

it('MODEL-SYNC-01 explicit Max remains Max even when Pro and Max share a physical model', () => {
  update(s => { s.cloudModels = { pro: 'same', max: 'same', mini: 'mini' }; s.cloudLegacy = { pro: ['same'], max: ['same'] }; s.model = 'lom-max'; });
  expect(modelChoice('cloud::old', 'max')?.name).toBe('Lom Max');
  expect(modelChoice('p_cloud::same')).toBeUndefined();
});
