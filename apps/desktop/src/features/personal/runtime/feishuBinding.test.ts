import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
const m = vi.hoisted(() => ({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:m.invoke}));
import { bindFeishuAssistant, feishuAssistant, scopedFeishuStatus } from './feishuBinding';
const a = { id: 'pa_a', name: 'A', directory: '/a', workspace: '/a' };
const b = { ...a, id: 'pa_b', name: 'B' };
const catalog = (items: typeof a[]) => localStorage.setItem('lom.personal.v1:owner', JSON.stringify({ items }));
beforeEach(() => { localStorage.clear(); S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' };m.invoke.mockReset(); });
it('FEISHU-MULTI stores two exclusive bots without overwriting old migration input',()=>{
 catalog([a,b]); const old=JSON.stringify({appId:'cli_a',assistantId:a.id});localStorage.setItem('lom.personal.feishu-binding.v1:owner',old);
 bindFeishuAssistant('owner','cli_a',a.id);bindFeishuAssistant('owner','cli_b',b.id);
 expect(feishuAssistant('owner','cli_a')?.id).toBe(a.id);expect(feishuAssistant('owner','cli_b')?.id).toBe(b.id);
 expect(localStorage.getItem('lom.personal.feishu-binding.v1:owner')).toBe(old);
 expect(()=>bindFeishuAssistant('owner','cli_a',b.id)).toThrow();
});
it('FEISHU-MULTI deleted owner retains exclusive recovery ownership and cannot transfer silently',()=>{
 catalog([a,b]);bindFeishuAssistant('owner','cli_a',a.id);catalog([b]);
 expect(feishuAssistant('owner','cli_a')).toBeUndefined();expect(()=>bindFeishuAssistant('owner','cli_a',b.id)).toThrow();
 expect(()=>feishuAssistant('other','cli_a')).toThrow('feishu.account_changed');
});
it('FEISHU-MULTI explicit legacy owner migrates only after native app match and retains v1',async()=>{
 catalog([a,b]);const old=JSON.stringify({appId:'cli_a',assistantId:a.id});localStorage.setItem('lom.personal.feishu-binding.v1:owner',old);
 m.invoke.mockImplementation(async(cmd,args)=>cmd==='feishu_migrate_legacy'||!args.assistantId?{configured:true,app_id:'cli_a',generation:1}:{configured:false,generation:0});
 expect((await scopedFeishuStatus('owner',a.id)).app_id).toBe('cli_a');
 expect(m.invoke).toHaveBeenCalledWith('feishu_migrate_legacy',{account:'owner',assistantId:a.id,appId:'cli_a'});
 expect(localStorage.getItem('lom.personal.feishu-binding.v1:owner')).toBe(old);
});
it('FEISHU-MULTI ambiguous legacy and mismatched app never migrate or guess selected assistant',async()=>{
 catalog([a,b]);m.invoke.mockImplementation(async(_cmd,args)=>!args.assistantId?{configured:true,app_id:'cli_a'}:{configured:false});
 await scopedFeishuStatus('owner',b.id);
 localStorage.setItem('lom.personal.feishu-binding.v1:owner',JSON.stringify({appId:'different',assistantId:b.id}));
 await scopedFeishuStatus('owner',b.id);
 expect(m.invoke.mock.calls.some(c=>c[0]==='feishu_migrate_legacy')).toBe(false);
});
