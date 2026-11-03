import { beforeEach, expect, it, vi } from 'vitest';
const mock=vi.hoisted(()=>({read:vi.fn(),save:vi.fn()}));
vi.mock('@/features/personal/runtime/memory',()=>({readDocument:mock.read,saveDocument:mock.save}));
import { S } from '@/state/store';
import { applyPersonalProfile, withPersonalProfile } from './personalProfile';
import { personalConfigUpdating } from '@/features/personal/runtime/configurationLock';
const a={id:'pa_test',name:'测试助理',directory:'/fixture',workspace:'/fixture',conversation:'c'};
const p={name:'审查',rules:'核对证据'};
beforeEach(()=>{vi.clearAllMocks();S.cloud='signed-in';S.account={id:'owner',name:'A',email:''};S.running={};});
it('HUB-01 personal rules use guarded document writes and verify the actual saved content',async()=>{
  mock.save.mockResolvedValue(undefined);mock.read.mockResolvedValue(withPersonalProfile('原规则\n',p));
  await applyPersonalProfile(a,'原规则\n',p);
  expect(mock.save).toHaveBeenCalledWith(a,'AGENTS.md','原规则\n',withPersonalProfile('原规则\n',p));
  expect(personalConfigUpdating('c')).toBe(false);
});
it('HUB-01 active assistants reject changes and failed verification is never success',async()=>{
  S.running.c=true;await expect(applyPersonalProfile(a,'before',p)).rejects.toThrow('正在执行');expect(mock.save).not.toHaveBeenCalled();
  S.running.c=false;mock.save.mockResolvedValue(undefined);mock.read.mockResolvedValue('different');
  await expect(applyPersonalProfile(a,'before',p)).rejects.toThrow('未确认');expect(personalConfigUpdating('c')).toBe(false);
});
it('HUB-01 personal documents never grow beyond the runtime context file budget',async()=>{
  await expect(applyPersonalProfile(a,'中'.repeat(5500),p)).rejects.toThrow('上限');
  expect(mock.save).not.toHaveBeenCalled();
});
