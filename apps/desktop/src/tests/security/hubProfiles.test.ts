import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { profileRules, readProfile, saveProfile } from '@/features/capabilities/runtime/profiles';
beforeEach(()=>{localStorage.clear();S.cloud='signed-in';S.account={id:'a',name:'A',email:''};});
it('HUB-01 profile storage isolates accounts and refuses stale previews or failed writes', () => {
  const expected=JSON.stringify(readProfile('pc'));
  saveProfile('pc',{name:'角色',rules:'只属于 A'},expected);
  expect(()=>saveProfile('pc',{name:'覆盖',rules:'x'},expected)).toThrow('已变化');
  S.account={id:'b',name:'B',email:''}; expect(profileRules('pc')).toBe('');
  const write=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('blocked');});
  expect(()=>saveProfile('pc',{name:'角色',rules:'x'},expected)).toThrow('存储'); write.mockRestore();
});
