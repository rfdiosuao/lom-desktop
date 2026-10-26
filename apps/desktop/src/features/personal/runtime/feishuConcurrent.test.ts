import { beforeEach, expect, it, vi } from 'vitest';
import { beginAuthChange } from '@/features/account/runtime/authScope';
import { S, update } from '@/state/store';
import type { Conv } from '@/state/types';
const m=vi.hoisted(()=>({invoke:vi.fn(),handlers:{} as Record<string,(e:{payload:unknown})=>void>,send:vi.fn(),stream:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:m.invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen:async(name:string,fn:(e:{payload:unknown})=>void)=>{m.handlers[name]=fn;return()=>{};}}));
vi.mock('@/core/platform',()=>({inShell:()=>true}));
vi.mock('@/features/chat/runtime/tasks',()=>({sendFromChannel:m.send}));
vi.mock('./feishuCard',()=>({streamReply:m.stream}));
vi.mock('./session',()=>({ensureConversation:vi.fn()}));
import { startFeishuRelay, restartFeishuRelay, stopFeishuRelay, syncFeishuRelay } from './feishuRelay';
const event=(assistant:string,generation=1)=>({account:'owner',assistant_id:assistant,app_id:`bot_${assistant}`,generation,message_id:`message_${assistant}`,chat_id:'chat',text:'hello'});
beforeEach(async()=>{
 m.invoke.mockReset();m.send.mockReset();m.stream.mockReset();localStorage.clear();
 S.cloud='signed-in';S.account={id:'owner',name:'',email:''};S.running={};
 S.convs=['a','b'].map(id=>({id,personal:{id,name:id,directory:`/${id}`},messages:[]} as unknown as Conv));
 localStorage.setItem('lom.personal.v1:owner',JSON.stringify({items:['a','b'].map(id=>({id,name:id,directory:`/${id}`,workspace:`/${id}`,conversation:id}))}));
 m.invoke.mockImplementation(async(cmd,args)=>cmd==='feishu_status'?{configured:true,connected:true,app_id:`bot_${args.assistantId}`,generation:1}:cmd==='feishu_listen_start'?1:{});
 m.send.mockImplementation(async(c)=>({id:`u_${c.id}`,type:'user',at:1}));m.stream.mockResolvedValue(undefined);
 startFeishuRelay();await restartFeishuRelay('owner','a');await restartFeishuRelay('owner','b');m.invoke.mockClear();
});
it('FEISHU-MULTI two bots stay online with independent queues: busy A never blocks B',async()=>{
 update(s=>{s.running.a=true;});
 m.handlers['feishu-message']({payload:event('a')});m.handlers['feishu-message']({payload:event('b')});
 await vi.waitFor(()=>expect(m.stream).toHaveBeenCalledWith(expect.objectContaining({assistantId:'b',appId:'bot_b',generation:1}),'message_b',S.convs[1],expect.anything(),300,expect.any(Function)));
 expect(m.send.mock.calls.map(c=>c[0].id)).toEqual(['b']);
 update(s=>{delete s.running.a;});await vi.waitFor(()=>expect(m.send).toHaveBeenCalledTimes(2));
 expect(m.invoke.mock.calls.filter(c=>c[0]==='feishu_api').map(c=>c[1].assistantId)).toContain('a');
});
it('FEISHU-MULTI stopping B and foreign/stale events cannot interrupt A or route to B',async()=>{
 await stopFeishuRelay('owner','b');
 m.handlers['feishu-message']({payload:event('b')});m.handlers['feishu-message']({payload:event('a',0)});
 m.handlers['feishu-message']({payload:{...event('a'),app_id:'bot_b'}});
 m.handlers['feishu-message']({payload:event('a')});
 await vi.waitFor(()=>expect(m.send).toHaveBeenCalledTimes(1));expect(m.send.mock.calls[0][0].id).toBe('a');
 expect(m.invoke.mock.calls.filter(c=>c[0]==='feishu_listen_stop').every(c=>c[1].assistantId==='b')).toBe(true);
});
it('FEISHU-MULTI reconnect invalidates A queued delivery without affecting B',async()=>{
 update(s=>{s.running.a=true;});m.handlers['feishu-message']({payload:event('a')});
 await restartFeishuRelay('owner','a');update(s=>{delete s.running.a;});
 m.handlers['feishu-message']({payload:event('b')});await vi.waitFor(()=>expect(m.send).toHaveBeenCalledTimes(1));
 expect(m.send.mock.calls[0][0].id).toBe('b');
});

it('FEISHU-MULTI stopping while native status is pending prevents listener resurrection',async()=>{
 await stopFeishuRelay('owner','a');
 let release!: (value:unknown)=>void;
 m.invoke.mockImplementation(async(cmd,args)=>cmd==='feishu_status'&&args.assistantId==='a'?new Promise(resolve=>{release=resolve;}):{});
 const starting=restartFeishuRelay('owner','a');await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
 await stopFeishuRelay('owner','a');
 release({configured:true,connected:true,app_id:'bot_a',generation:1});await starting;
 expect(m.invoke.mock.calls.filter(c=>c[0]==='feishu_listen_start')).toHaveLength(0);
});
it('FEISHU-MULTI logout stops OAuth-only account even with no active bot relay',async()=>{
 await stopFeishuRelay('owner','a');await stopFeishuRelay('owner','b');m.invoke.mockClear();
 beginAuthChange();
 expect(m.invoke).toHaveBeenCalledWith('feishu_stop_account',{account:'owner'});
 m.handlers['feishu-message']({payload:event('a')});expect(m.send).not.toHaveBeenCalled();
});

it('FEISHU-MULTI explicit restart awaits the invalidated background start then connects immediately',async()=>{
 await stopFeishuRelay('owner','a');
 let release!: (value:unknown)=>void;
 let delayed=true;
 m.invoke.mockImplementation(async(cmd,args)=>{
  if(cmd==='feishu_status') {
   if(args.assistantId==='a'&&delayed) {delayed=false;return new Promise(resolve=>{release=resolve;});}
   return {configured:true,connected:true,app_id:`bot_${args.assistantId}`,generation:1};
  }
  return cmd==='feishu_listen_start'?1:{};
 });
 const background=syncFeishuRelay();await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
 const restarted=restartFeishuRelay('owner','a');
 await vi.waitFor(()=>expect(m.invoke).toHaveBeenCalledWith('feishu_listen_stop',{account:'owner',assistantId:'a'}));
 release({configured:true,connected:true,app_id:'bot_a',generation:1});
 await Promise.all([background,restarted]);
 expect(m.invoke).toHaveBeenCalledWith('feishu_listen_start',{account:'owner',assistantId:'a'});
 m.handlers['feishu-message']({payload:event('a')});await vi.waitFor(()=>expect(m.send).toHaveBeenCalledTimes(1));
 expect(m.send.mock.calls[0][0].id).toBe('a');
});
