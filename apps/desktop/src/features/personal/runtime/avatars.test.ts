import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { S } from '@/state/store';
import { addAssistant, loadAssistants } from './catalog';
import { avatarUrl } from './avatars';
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn(async()=>'/assistant')}));
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();S.cloud='signed-in';S.account={id:'a',name:'',email:''};});
it('PA-AVATAR defaults to 06 and persists another choice per assistant',async()=>{
 await addAssistant('小麓');await addAssistant('工作助理','03');expect(loadAssistants().items.map(a=>a.avatar)).toEqual(['06','03']);
});
it('PA-AVATAR legacy and unknown IDs use a local default and invalid choices cannot persist',async()=>{
 expect(avatarUrl()).toBe('/mascots/deer-06.png');expect(avatarUrl('https://external.invalid')).toBe('/mascots/deer-06.png');
 await expect(addAssistant('bad','arbitrary' as any)).rejects.toThrow('形象');expect(invoke).not.toHaveBeenCalled();
});
