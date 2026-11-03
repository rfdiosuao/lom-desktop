import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import { addAssistant, loadAssistants } from '../runtime/catalog';
import { PersonalAvatarModal } from './PersonalAvatarModal';
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn(async()=>'/assistant')}));
let host:HTMLDivElement,root:Root;
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 vi.clearAllMocks();localStorage.clear();host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
 S.cloud='signed-in';S.account={id:'a',name:'',email:''};S.convs=[];S.modals=[{id:'personalAvatar',props:{}}];
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const render=async(id:string,onSaved=vi.fn())=>{
 await act(async()=>root.render(<PersonalAvatarModal p={{account:'a',assistantId:id,onSaved}} />));return onSaved;
};
it('PA-AVATAR-01 saves the chosen preset only after confirmation and syncs open conversations',async()=>{
 const a=await addAssistant('小麓','06');
 S.convs=[{id:'conv-a',owner:'pc',title:'小麓',updated:1,messages:[],personal:{id:a.id,name:'小麓',directory:'/assistant',avatar:'06'}}] as any;
 const onSaved=await render(a.id);
 await act(async()=>host.querySelector<HTMLInputElement>('input[value="02"]')!.click());
 expect(loadAssistants().items[0].avatar).toBe('06');
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='保存头像')!.click());
 const saved=loadAssistants().items[0];
 expect(saved.avatar).toBe('02');expect(saved.avatarImage).toBeUndefined();
 expect(S.convs[0].personal?.avatar).toBe('02');expect(onSaved).toHaveBeenCalledOnce();
});
it('PA-AVATAR-01 cancel keeps the original avatar',async()=>{
 const a=await addAssistant('小麓','06');
 await render(a.id);
 await act(async()=>host.querySelector<HTMLInputElement>('input[value="03"]')!.click());
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='取消')!.click());
 expect(loadAssistants().items[0].avatar).toBe('06');
});
it('PA-AVATAR-01 a failed save keeps the draft and lets the user retry',async()=>{
 const a=await addAssistant('小麓','06');
 await render(a.id);
 await act(async()=>host.querySelector<HTMLInputElement>('input[value="04"]')!.click());
 const setItem=Storage.prototype.setItem;
 const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key:string,value:string){
  if(key==='lom.personal.v1:a') throw new DOMException('full','QuotaExceededError');
  return setItem.call(this,key,value);
 });
 try{
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='保存头像')!.click());
  expect(host.querySelector('[role=alert]')?.textContent).toContain('无法保存本机助理配置');
  expect(loadAssistants().items[0].avatar).toBe('06');
  expect(S.modals).toHaveLength(1);
  expect(host.querySelector<HTMLInputElement>('input[value="04"]')!.checked).toBe(true);
 }finally{spy.mockRestore();}
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='保存头像')!.click());
 expect(loadAssistants().items[0].avatar).toBe('04');
});
it('PA-AVATAR-01 disables saving after the account switches',async()=>{
 const a=await addAssistant('小麓','06');
 await render(a.id);
 await act(async()=>update(s=>{s.account={id:'b',name:'',email:''};}));
 const save=[...host.querySelectorAll('button')].find(b=>b.textContent==='保存头像') as HTMLButtonElement;
 expect(save.disabled).toBe(true);
 expect(host.textContent).toContain('账号已切换');
 expect(loadAssistants('a').items[0].avatar).toBe('06');
});
