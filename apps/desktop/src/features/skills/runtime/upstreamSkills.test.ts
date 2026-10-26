import { expect, it } from 'vitest';
import { isInternalSkill } from './upstreamSkills';

it('D04 上游内部技能被识别为隐藏，场景技能和用户自建的同名技能不受影响', () => {
  for (const name of ['aionui-config', 'aionui-webui-setup', 'openclaw-setup', 'session-message', 'conversation-create', 'cron']) {
    expect(isInternalSkill({ name, description: '', source: 'builtin' })).toBe(true);
  }
  expect(isInternalSkill({ name: 'cron', description: '', source: 'custom' })).toBe(false);
  expect(isInternalSkill({ name: 'xiaohongshu-recruiter', description: '', source: 'builtin' })).toBe(false);
  expect(isInternalSkill({ name: 'story-roleplay', description: '', source: 'builtin' })).toBe(false);
});
