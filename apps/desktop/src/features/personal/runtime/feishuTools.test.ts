import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';
const m = vi.hoisted(() => ({ invoke: vi.fn(), bound: vi.fn(), owned: vi.fn(() => true) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
vi.mock('./feishuBinding', () => ({ feishuAssistant: m.bound }));
vi.mock('@/features/phones/runtime/phoneCommander', () => ({ scopeOwnedByAccount: m.owned }));
vi.mock('@/features/settings/runtime/audit', () => ({ audit: vi.fn() }));
import { executeFeishuTool } from './feishuTools';
const call = (name = 'feishu_list_chats', args = {}) => ({ id: crypto.randomUUID(), scope: 'pa-1', name, arguments: JSON.stringify(args) });
beforeEach(() => {
  vi.clearAllMocks(); m.owned.mockReturnValue(true);
  S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' };
  S.convs = [{ id: 'pa', personal: { id: 'a' }, personalScope: 'pa-1', messages: [] } as unknown as Conv];
  S.running = { pa: true }; m.bound.mockReturnValue({ id: 'a' });
  m.invoke.mockImplementation(async cmd => cmd === 'feishu_status' ? { app_id: 'cli_a', authorized: true, generation: 1 } : { items: [] });
});
it('FEISHU-09 AC-1 refuses other scopes and an assistant not owning the bot', async () => {
  expect((await executeFeishuTool({ ...call(), scope: 'task' })).isError).toBe(true);
  S.convs[0].personalScope = 'another'; expect((await executeFeishuTool(call())).isError).toBe(true);
  expect(m.invoke.mock.calls.some(([name]) => name === 'feishu_tool_execute')).toBe(false);
});
it('FEISHU-09 AC-2 calls the adapter under the active bound assistant', async () => {
  expect((await executeFeishuTool(call())).isError).not.toBe(true);
  expect(m.invoke).toHaveBeenCalledWith('feishu_tool_execute', expect.objectContaining({ account: 'owner', appId: 'cli_a', assistantId: 'a', generation: 1 }));
});
it('FEISHU-09 AC-3 returns structured need_user_auth and coalesces notification', async () => {
  m.invoke.mockResolvedValue({ app_id: 'cli_a', authorized: false, generation: 1 }); const notify = vi.fn();
  const r = await executeFeishuTool(call(), { needUserAuth: notify }); await executeFeishuTool(call(), { needUserAuth: notify });
  expect(r.content[0].text).toContain('feishu.need_user_auth'); expect(notify).toHaveBeenCalledTimes(1);
});
it('FEISHU-09 AC-4 sends fail closed and approval includes full content', async () => {
  const c = call('feishu_send_message', { chat_id: 'oc_test', text: 'Hello' });
  expect((await executeFeishuTool(c)).isError).toBe(true);
  const approve = vi.fn().mockResolvedValue(false); await executeFeishuTool({ ...c, id: crypto.randomUUID() }, { approve });
  expect(approve).toHaveBeenCalledWith(expect.objectContaining({ arguments: { chat_id: 'oc_test', text: 'Hello' }, current: expect.any(Function) }));
  expect(m.invoke.mock.calls.some(([name]) => name === 'feishu_tool_execute')).toBe(false);
});
it('FEISHU-09 AC-4 ask tier applies to routine reads', async () => {
  const approve = vi.fn().mockResolvedValue(false);
  expect((await executeFeishuTool(call(), { requiresApproval: () => true, approve })).isError).toBe(true);
  expect(approve).toHaveBeenCalledTimes(1);
});
it('FEISHU-09 AC-6 withholds results after account switch', async () => {
  m.invoke.mockImplementation(async name => {
    if (name === 'feishu_status') return { app_id: 'cli_a', authorized: true, generation: 1 };
    S.account = { id: 'another', name: '', email: '' }; return { text: 'private-result' };
  });
  const r = await executeFeishuTool(call()); expect(r.isError).toBe(true); expect(r.content[0].text).not.toContain('private-result');
});
it('FEISHU-09 explicitly enabled full access sends without a second approval and stays bot scoped',async()=>{
  const approve=vi.fn();
  const r=await executeFeishuTool(call('feishu_send_message',{chat_id:'oc_test',text:'Hello'}),{fullAccess:()=>true,approve,requiresApproval:()=>false});
  expect(r.isError).not.toBe(true);expect(approve).not.toHaveBeenCalled();
  expect(m.invoke).toHaveBeenCalledWith('feishu_tool_execute',expect.objectContaining({appId:'cli_a',account:'owner'}));
});

it('FEISHU-MULTI credentials derive only from the registered conversation and never model input',async()=>{
 await executeFeishuTool(call('feishu_list_chats',{assistantId:'victim',account:'other'}));
 expect(m.invoke).toHaveBeenCalledWith('feishu_status',{account:'owner',assistantId:'a'});
 expect(m.invoke).toHaveBeenCalledWith('feishu_tool_execute',expect.objectContaining({account:'owner',assistantId:'a',appId:'cli_a',generation:1}));
});

it('FEISHU-MULTI missing native scoped generation never falls back to account credentials',async()=>{
 m.invoke.mockResolvedValue({app_id:'cli_a',authorized:true});
 expect((await executeFeishuTool(call())).isError).toBe(true);
 expect(m.invoke.mock.calls.some(c=>c[0]==='feishu_tool_execute')).toBe(false);
});
