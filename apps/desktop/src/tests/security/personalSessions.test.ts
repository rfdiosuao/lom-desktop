import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';
import { beginAuthChange } from '@/features/account/runtime/authScope';
import { invalidateDelegations } from '@/features/teams/runtime/delegationLifecycle';
const m = vi.hoisted(() => ({ api: vi.fn(), send: vi.fn(), history: vi.fn() }));
vi.mock('@/core/client', async load => ({...await load<typeof import('@/core/client')>(), api:m.api}));
vi.mock('@/features/chat/runtime/tasks',()=>({sendFromChannel:m.send}));
vi.mock('@/features/phones/runtime/phoneChat',()=>({sendPhone:vi.fn()}));
vi.mock('@/features/chat/runtime/history',()=>({loadHistory:m.history}));
vi.mock('@/features/phones/runtime/phoneCommander',()=>({scopeOwnedByAccount:()=>true}));
vi.mock('@/features/settings/runtime/audit',()=>({audit:vi.fn()}));
import { executeSessionTool } from '@/features/personal/runtime/sessionTools';
let self: Conv, target: Conv;
beforeEach(()=>{
  beginAuthChange(); vi.clearAllMocks(); S.cloud='signed-in';S.account={id:'owner',name:'',email:''};
  self={id:'pa',owner:'pc',title:'self',updated:0,messages:[],personal:{id:'pa_a',name:'self',directory:'/a'},personalScope:'pa-test'};
  target={id:'target',owner:'pc',title:'target',updated:0,messages:[],remote:true,loaded:false};
  S.convs=[self,target];S.running={pa:true};m.api.mockResolvedValue({runtime:{is_processing:false}});m.send.mockResolvedValue({id:'sent'});
});
const call=(name:string)=>executeSessionTool({id:'security-call',scope:'pa-test',name,arguments:JSON.stringify({session_id:'target',text:'fix'})});
it('PA04 logout while history loads cannot deliver old-account content',async()=>{
  m.history.mockImplementation(async()=>{beginAuthChange();return {messages:[{id:'secret',type:'assistant',at:1,text:'old-account-only'}]};});
  const r=await call('session_read'); expect(r.isError).toBe(true);expect(r.content[0].text).not.toContain('old-account-only');
});
it('PA04 stop-and-resume cannot revive an earlier in-flight tool call',async()=>{
  m.history.mockImplementation(async()=>{invalidateDelegations('pa');return {messages:[{id:'old',type:'assistant',at:1,text:'stopped-result'}]};});
  const r=await call('session_read');expect(r.isError).toBe(true);expect(r.content[0].text).not.toContain('stopped-result');
});
it('PA04 a changed account during dispatch preflight does not send to a target',async()=>{
  m.api.mockImplementation(async()=>{beginAuthChange();return {runtime:{is_processing:false}};});
  expect((await call('session_send')).isError).toBe(true);expect(m.send).not.toHaveBeenCalled();
});
it('PA04 late old-account errors do not expose their content after logout',async()=>{
  m.history.mockImplementation(async()=>{beginAuthChange();throw new Error('old-account-private-error');});
  const r=await call('session_read');expect(r.isError).toBe(true);expect(r.content[0].text).not.toContain('old-account-private-error');
});
it('PA04 removal of a target while checking runtime prevents a stale dispatch',async()=>{
  m.api.mockImplementation(async()=>{S.convs=[self];return {runtime:{is_processing:false}};});
  expect((await call('session_send')).isError).toBe(true);expect(m.send).not.toHaveBeenCalled();
});
