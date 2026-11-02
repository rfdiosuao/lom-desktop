import { beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { Conv } from '@/state/types';
const m=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:m.invoke}));
vi.mock('@/features/personal/runtime/feishu', async importOriginal => ({ ...await importOriginal<object>(), feishuStatus:async()=>{const real=await importOriginal<typeof import('@/features/personal/runtime/feishu')>();real.recordFeishuScope({account:'owner',assistantId:'pa_a',appId:'cli_a',generation:1});return {configured:true,connected:true,app_id:'cli_a',generation:1};} }));
const source = {account:'owner',assistantId:'pa_a',appId:'cli_a',generation:1};
import { requestPersonalToolApproval, consumeFeishuApprovalText, consumeFeishuApprovalAction } from '@/features/personal/runtime/feishuApprovals';
let c: Conv;
beforeEach(()=>{
 localStorage.clear(); S.modals=[]; S.account={id:'owner',name:'',email:''}; S.cloud='signed-in';
 c={id:'c1',remote:true,owner:'pc',messages:[{id:'u',type:'user',text:'请处理',at:1,source:'feishu'}],personal:{id:'pa_a',name:'A',directory:'/a'}} as Conv;
 S.convs=[c]; S.running={c1:true};
 localStorage.setItem('lom.personal.v1:owner',JSON.stringify({items:[{id:'pa_a',name:'A',directory:'/a',workspace:'/a',conversation:'c1'}]}));
 m.invoke.mockReset();m.invoke.mockResolvedValue({});
});
it('FEISHU-07 bare approval text never grants permission',()=>{ expect(consumeFeishuApprovalText('同意', source)).toBe(false); });
it('FEISHU-07 explicit nonce approves exactly one bound operation and cannot replay',async()=>{
 const pending=requestPersonalToolApproval(c,'发送给用户甲：你好',()=>true);
 await vi.waitFor(()=>expect(m.invoke).toHaveBeenCalledWith('feishu_owner_notice',expect.anything()));
 const nonce=m.invoke.mock.calls.find(x=>x[0]==='feishu_owner_notice')![1].nonce;
 expect(consumeFeishuApprovalText(`允许 ${nonce}`, source)).toBe(true);
 expect(await pending).toBe(true);
 expect(consumeFeishuApprovalText(`允许 ${nonce}`, source)).toBe(true);
});
it('FEISHU-07 account change invalidates the old approval',async()=>{
 const pending=requestPersonalToolApproval(c,'读取文档',()=>true);
 await vi.waitFor(()=>expect(m.invoke).toHaveBeenCalled());
 const nonce=m.invoke.mock.calls[0][1].nonce;
 update(s=>{s.account={id:'another',name:'',email:''};});
 consumeFeishuApprovalText(`允许 ${nonce}`, source);
 expect(await pending).toBe(false);
});
it('FEISHU-07 callback must match account and bot before consuming its nonce',async()=>{
 const pending=requestPersonalToolApproval(c,'发消息',()=>true);
 await vi.waitFor(()=>expect(m.invoke).toHaveBeenCalled());
 const nonce=m.invoke.mock.calls[0][1].nonce;
 consumeFeishuApprovalAction({...source,account:'another'},nonce,'once');
 consumeFeishuApprovalAction({...source,appId:'cli_other'},nonce,'once');
 consumeFeishuApprovalAction(source,nonce,'always');
 expect(S.running.c1).toBe(true);
 consumeFeishuApprovalAction(source,nonce,'deny');
 expect(await pending).toBe(false);
});
it('FEISHU-07 a new turn invalidates old approval, never approving the replacement operation',async()=>{
 const pending=requestPersonalToolApproval(c,'操作甲',()=>true);
 await vi.waitFor(()=>expect(m.invoke).toHaveBeenCalled());
 const nonce=m.invoke.mock.calls[0][1].nonce;
 update(()=>c.messages.push({id:'next',type:'user',text:'操作乙',at:2,source:'feishu'}));
 consumeFeishuApprovalText(`允许 ${nonce}`, source);
 expect(await pending).toBe(false);
});
it('FEISHU-07 approval notifications redact common credentials in JSON and headers',async()=>{
 const waiting=requestPersonalToolApproval(c,'{"api_key":"private-value"} Authorization: Basic private-basic ?code=private-code',()=>true);
 await vi.waitFor(()=>expect(m.invoke).toHaveBeenCalledWith('feishu_owner_notice',expect.anything()));
 const call=m.invoke.mock.calls.find(x=>x[0]==='feishu_owner_notice')![1];
 for(const secret of ['private-value','private-basic','private-code']) expect(call.summary).not.toContain(secret);
 consumeFeishuApprovalText(`拒绝 ${call.nonce}`, source);expect(await waiting).toBe(false);
});

it('FEISHU-MULTI text nonce from another assistant or stale generation cannot approve',async()=>{
 const waiting=requestPersonalToolApproval(c,'发送消息',()=>true);
 await vi.waitFor(()=>expect(m.invoke).toHaveBeenCalled());
 const nonce=m.invoke.mock.calls[0][1].nonce;
 consumeFeishuApprovalText(`允许 ${nonce}`,{...source,assistantId:'pa_b'});
 consumeFeishuApprovalText(`允许 ${nonce}`,{...source,appId:'cli_b'});
 consumeFeishuApprovalText(`允许 ${nonce}`,{...source,generation:0});
 let done=false; void waiting.then(()=>done=true); await Promise.resolve(); expect(done).toBe(false);
 consumeFeishuApprovalText(`拒绝 ${nonce}`,source); expect(await waiting).toBe(false);
});
