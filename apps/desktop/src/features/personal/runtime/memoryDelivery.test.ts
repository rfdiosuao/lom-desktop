import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { api, CoreError } from '@/core/client';
import { sendToTask } from '@/features/chat/runtime/tasks';
import { beginAuthChange } from '@/features/account/runtime/authScope';
vi.mock('@/features/phones/runtime/phoneCommander', async load => ({ ...await load<typeof import('@/features/phones/runtime/phoneCommander')>(), ensurePersonalBridge: vi.fn(async () => {}), personalExtra: vi.fn(async () => ({ lom_personal_scope: 'pa-test', selected_mcp_server_ids: ['mcp_bridge'] })) }));
vi.mock('@/core/client', async load => ({ ...await load<typeof import('@/core/client')>(), api: vi.fn() }));
vi.mock('@/features/account/runtime/cloud', () => ({ ensureLomSelection: vi.fn(async () => {}) }));
vi.mock('@/features/chat/runtime/taskModel', async load => ({ ...await load<typeof import('@/features/chat/runtime/taskModel')>(), ensureTaskModel: vi.fn(async () => {}) }));
vi.mock('@/features/settings/runtime/preferences', async load => ({ ...await load<typeof import('@/features/settings/runtime/preferences')>(), ensureTaskPermissions: vi.fn(async () => {}) }));
vi.mock('./memory', async load => ({ ...await load<typeof import('./memory')>(), readDocument: vi.fn(async () => 'confirmed user preferences') }));
beforeEach(()=>{
 beginAuthChange();vi.clearAllMocks();localStorage.clear();S.cloud='signed-in';S.account={id:'owner',name:'',email:''};S.running={};S.teams=[];
 S.providers=[{id:'cloud',name:'Lom 云端',enabled:true,models:['pro']} as any];S.cloudModels={pro:'pro',max:'max',mini:'mini'};
 S.convs=[{id:crypto.randomUUID(),owner:'pc',title:'小麓',updated:1,remote:true,messages:[],modelId:'cloud::pro',personal:{id:'pa_a',name:'小麓',directory:'/a'}}];
 localStorage.setItem('lom.personal.v1:owner',JSON.stringify({items:[{id:'pa_a',name:'小麓',directory:'/a',workspace:'/a',conversation:S.convs[0].id}]}));
});
it('PA03 real send boundary retries rejected memory then suppresses it after confirmed delivery',async()=>{
 vi.mocked(api).mockRejectedValueOnce(new CoreError('bad','rejected',400)).mockResolvedValue({turn_id:'turn'});
 const c=S.convs[0];expect(await sendToTask(c,'one',[])).toBe(false);expect(await sendToTask(c,'two',[])).toBe(true);expect(await sendToTask(c,'three',[])).toBe(true);
 const content=vi.mocked(api).mock.calls.map(call=>(call[2] as any).content);
 expect(content[0]).toContain('[LOM_PERSONAL_MEMORY_V1]');expect(content[1]).toContain('[LOM_PERSONAL_MEMORY_V1]');expect(content[2]).not.toContain('[LOM_PERSONAL_MEMORY_V1]');
 expect(c.messages.filter(m=>m.type==='user').map(m=>m.text)).toEqual(['one','two','three']);
});
