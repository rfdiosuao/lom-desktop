import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { S } from '@/state/store';
import { addAssistant, loadAssistants } from './catalog';
import { MAX_AVATAR_DATA_URL, avatarUrl, customAvatar, isAvatarImage } from './avatars';
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn(async()=>'/assistant')}));
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();S.cloud='signed-in';S.account={id:'a',name:'',email:''};});
it('PA-AVATAR defaults to 06 and persists another choice per assistant',async()=>{
 await addAssistant('小麓');await addAssistant('工作助理','03');expect(loadAssistants().items.map(a=>a.avatar)).toEqual(['06','03']);
});
it('PA-AVATAR legacy and unknown IDs use a local default and invalid choices cannot persist',async()=>{
 expect(avatarUrl()).toBe('/mascots/deer-06.png');expect(avatarUrl('https://external.invalid')).toBe('/mascots/deer-06.png');
 await expect(addAssistant('bad','arbitrary' as any)).rejects.toThrow('形象');expect(invoke).not.toHaveBeenCalled();
});
it('PA-AVATAR-01 accepts only bounded image data URLs and resolves a custom image over the preset',()=>{
 const image='data:image/webp;base64,AAAA';
 expect(isAvatarImage(image)).toBe(true);expect(isAvatarImage('https://external.invalid')).toBe(false);
 expect(isAvatarImage('data:text/html;base64,AAAA')).toBe(false);
 expect(isAvatarImage(`data:image/png;base64,${'A'.repeat(MAX_AVATAR_DATA_URL)}`)).toBe(false);
 expect(customAvatar({avatar:'02',avatarImage:image})).toBe(image);
 expect(customAvatar({avatar:'02',avatarImage:'broken'})).toBeUndefined();
});
it('PA-AVATAR-01 rejects an invalid uploaded image when creating an assistant',async()=>{
 await expect(addAssistant('小麓','02','data:text/html;base64,AAAA')).rejects.toThrow('头像图片');
 expect(invoke).not.toHaveBeenCalled();
});
