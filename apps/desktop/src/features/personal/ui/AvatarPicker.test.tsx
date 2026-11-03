import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AvatarPicker } from './AvatarPicker';
const IMAGE='data:image/jpeg;base64,AAAA';
const mount=async(ui:ReactElement)=>{const host=document.createElement('div'),root=createRoot(host);await act(async()=>root.render(ui));return{host,root};};
it('PA-AVATAR shows six images, defaults to 06 and selects an alternative',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);const choose=vi.fn();
 try{await act(async()=>root.render(<AvatarPicker onChange={choose}/>));
 const radios=host.querySelectorAll<HTMLInputElement>('input[type=radio]');expect(radios).toHaveLength(6);expect(radios[5].checked).toBe(true);expect(host.querySelectorAll('img')).toHaveLength(6);
 await act(async()=>radios[0].click());expect(choose).toHaveBeenCalledWith('01');expect(radios[0].checked).toBe(true);expect(radios[5].checked).toBe(false);
 }finally{await act(async()=>root.unmount());}
});
it('PA-AVATAR-01 shows an existing custom image as the selected draft and restores the default',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const choose=vi.fn(),{host,root}=await mount(<AvatarPicker initial={{avatar:'03',avatarImage:IMAGE}} onChange={choose}/>);
 try{
  const custom=host.querySelector('.pa-avatar-option--upload')!;
  expect(custom.classList.contains('is-selected')).toBe(true);
  expect(host.querySelector('.pa-avatar-option--upload img')?.getAttribute('src')).toBe(IMAGE);
  expect([...host.querySelectorAll<HTMLInputElement>('input[type=radio]')].some(r=>r.checked)).toBe(false);
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='恢复默认形象')!.click());
  expect(choose).toHaveBeenCalledWith('06');
  expect(custom.classList.contains('is-selected')).toBe(false);
  expect(host.querySelector<HTMLInputElement>('input[value="06"]')!.checked).toBe(true);
 }finally{await act(async()=>root.unmount());}
});
it('PA-AVATAR-01 rejects an unsupported file before reading it and keeps the current choice',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const choose=vi.fn(),{host,root}=await mount(<AvatarPicker onChange={choose}/>);
 try{
  const input=host.querySelector<HTMLInputElement>('input[type=file]')!;
  const file=new File(['x'],'avatar.txt',{type:'text/plain'});
  Object.defineProperty(input,'files',{value:[file],configurable:true});
  await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));await Promise.resolve();});
  expect(host.querySelector('[role=alert]')?.textContent).toContain('PNG');
  expect(choose).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLInputElement>('input[value="06"]')!.checked).toBe(true);
 }finally{await act(async()=>root.unmount());}
});
