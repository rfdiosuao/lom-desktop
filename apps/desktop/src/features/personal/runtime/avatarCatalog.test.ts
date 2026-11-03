import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { addAssistant, loadAssistants, storeAssistant, syncAssistantAvatar, updateAssistantAvatar } from './catalog';
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn(async()=>'/assistant')}));
const IMAGE='data:image/jpeg;base64,AAAA';
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();S.cloud='signed-in';S.account={id:'a',name:'',email:''};S.convs=[];});

it('PA-AVATAR-01 persists a custom avatar for one assistant without changing its other fields', async () => {
  const first=await addAssistant('小麓','02',IMAGE), second=await addAssistant('工作助理','03');
  const seeded=loadAssistants();
  const mine=seeded.items.find(x=>x.id===first.id)!;
  mine.conversation='conv-a'; mine.permission='full'; mine.workspace='/work';
  storeAssistant(mine); storeAssistant(seeded.items.find(x=>x.id===second.id)!);
  updateAssistantAvatar(first.id,{avatar:'05',avatarImage:IMAGE});
  const saved=loadAssistants(), a=saved.items.find(x=>x.id===first.id)!, b=saved.items.find(x=>x.id===second.id)!;
  expect(a).toMatchObject({name:'小麓',directory:'/assistant',workspace:'/work',conversation:'conv-a',permission:'full',avatar:'05',avatarImage:IMAGE});
  expect(b).toMatchObject({name:'工作助理',avatar:'03'});expect(b.avatarImage).toBeUndefined();
  expect(saved.selected).toBe(second.id);
});

it('PA-AVATAR-01 restores the preset when the custom image is removed', async () => {
  const a=await addAssistant('小麓','02',IMAGE);
  updateAssistantAvatar(a.id,{avatar:'05'});
  const saved=loadAssistants().items[0];
  expect(saved.avatar).toBe('05');expect(saved.avatarImage).toBeUndefined();
});

it('PA-AVATAR-01 drops a corrupt stored image but keeps the preset and the assistant', () => {
  localStorage.setItem('lom.personal.v1:a',JSON.stringify({items:[{id:'pa_x',name:'小麓',directory:'/x',workspace:'/x',avatar:'03',avatarImage:'not-an-image'}],selected:'pa_x'}));
  const saved=loadAssistants().items[0];
  expect(saved).toMatchObject({id:'pa_x',name:'小麓',avatar:'03'});expect(saved.avatarImage).toBeUndefined();
});

it('PA-AVATAR-01 keeps the original avatar when the local profile cannot be written', async () => {
  const a=await addAssistant('小麓','02',IMAGE);
  const setItem=Storage.prototype.setItem;
  const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this: Storage,key:string,value:string){
    if (key==='lom.personal.v1:a') throw new DOMException('full','QuotaExceededError');
    return setItem.call(this,key,value);
  });
  try{expect(()=>updateAssistantAvatar(a.id,{avatar:'04'})).toThrow('本机存储已满');}finally{spy.mockRestore();}
  const saved=loadAssistants().items[0];
  expect(saved.avatar).toBe('02');expect(saved.avatarImage).toBe(IMAGE);
});

it('PA-AVATAR-01 refuses a late save after the account switches and leaves both accounts isolated', async () => {
  const a=await addAssistant('小麓','02',IMAGE);
  S.account={id:'b',name:'',email:''};
  expect(()=>updateAssistantAvatar(a.id,{avatar:'04',avatarImage:IMAGE},'a')).toThrow('账号已切换');
  expect(loadAssistants('a').items[0]).toMatchObject({avatar:'02',avatarImage:IMAGE});
  expect(loadAssistants('b').items).toEqual([]);
});

it('PA-AVATAR-01 syncs the saved avatar to this assistant conversations only', async () => {
  const a=await addAssistant('小麓','02');
  S.convs=[
    {id:'conv-a',owner:'pc',title:'小麓',updated:1,messages:[],personal:{id:a.id,name:'小麓',directory:'/assistant',avatar:'02'}},
    {id:'conv-b',owner:'pc',title:'别人',updated:1,messages:[],personal:{id:'other',name:'别人',directory:'/b',avatar:'03'}},
  ] as any;
  const updated=updateAssistantAvatar(a.id,{avatar:'05',avatarImage:IMAGE});
  expect(syncAssistantAvatar(updated)).toBe(true);
  expect(S.convs[0].personal).toMatchObject({id:a.id,avatar:'05',image:IMAGE});
  expect(S.convs[1].personal).toMatchObject({id:'other',avatar:'03'});expect(S.convs[1].personal?.image).toBeUndefined();
  S.account={id:'b',name:'',email:''};
  expect(syncAssistantAvatar(updated,'a')).toBe(false);
  expect(S.convs[0].personal?.avatar).toBe('05');
});
