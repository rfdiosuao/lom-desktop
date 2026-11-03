import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/core/client';
import { S } from '@/state/store';
import { saveCoreSchedule, toggleCoreSchedule } from '@/features/schedules/runtime/schedules';
import { beginAuthChange } from '@/features/account/runtime/authScope';
import { storeAssistant } from './catalog';
import type { Schedule } from '@/state/types';
vi.mock('@/core/client', async load => ({ ...await load<typeof import('@/core/client')>(), api: vi.fn() }));
vi.mock('@/features/account/runtime/cloud', () => ({ ensureLomSelection: vi.fn(async () => {}) }));
const draft = (): Schedule => ({ id: '', name: '晨间提醒', prompt: '整理今天安排', exec: 'pc', freq: 'daily', time: '09:00', days: [], every: 60, enabled: true, runIn: 'same', runMode: 'default', last: null, runs: [], conversationId: 'assistant', agentConfig: { name: '小麓', workspace: '/assistant', model: { provider_id: 'cloud', model: 'pro' }, cli_path: '/must-not-copy' } });
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' };
  S.folder = '/background'; S.activeConv = 'background'; S.model = 'cloud::pro';
  S.providers = [{ id: 'cloud', name: 'Lom 云端', enabled: true, models: ['pro'] } as any]; S.cloudModels = { pro: 'pro', max: 'max', mini: 'mini' };
  S.convs = [{ id: 'assistant', title: '', owner: 'pc', messages: [], updated: 1, modelId: 'cloud::pro', personal: { id: 'pa_a', name: '小麓', directory: '/assistant' } }];
  storeAssistant({ id: 'pa_a', name: '小麓', directory: '/assistant', workspace: '/assistant', conversation: 'assistant' });
  vi.mocked(api).mockImplementation(async (method, path) => {
    if (path === '/api/assistants') return [{ id: 'lom', source: 'generated', enabled: true, agent: { type: 'aionrs' } }] as never;
    if (method === 'POST') return { id: 'created' } as never;
    return [] as never;
  });
});
it('PA02 creates cron through the real runtime using only assistant workspace and whitelisted configuration', async () => {
  await saveCoreSchedule(draft(), undefined, { personalId: 'pa_a' });
  expect(api).toHaveBeenCalledWith('POST', '/api/cron/jobs', expect.objectContaining({ conversation_id: 'assistant', agent_config: { name: '小麓', assistant_id: 'lom', model: { provider_id: 'cloud', model: 'pro' }, mode: 'default', workspace: '/assistant' } }));
  expect(S.folder).toBe('/background'); expect(S.activeConv).toBe('background');
});
it('PA02 never creates a cron job after authentication changes during assistant lookup', async () => {
  vi.mocked(api).mockImplementation(async (_method, path) => { if (path === '/api/assistants') { beginAuthChange(); return [{ id: 'lom', source: 'generated', enabled: true, agent: { type: 'aionrs' } }] as never; } return [] as never; });
  await expect(saveCoreSchedule(draft(), undefined, { personalId: 'pa_a' })).rejects.toThrow('账号已切换');
  expect(vi.mocked(api).mock.calls.some(x => x[0] === 'POST')).toBe(false);
});
it('PA02 refuses BYOK schedules and mismatched assistant conversations', async () => {
  S.providers.push({ id: 'external', name: 'My API', enabled: true, models: ['byok'] } as any);
  const f = draft(); f.agentConfig!.model = { provider_id: 'external', model: 'byok' };
  await expect(saveCoreSchedule(f, undefined, { personalId: 'pa_a' })).rejects.toThrow('Lom账号模型');
  f.conversationId = 'background'; await expect(saveCoreSchedule(f, undefined, { personalId: 'pa_a' })).rejects.toThrow('归属');
  expect(api).not.toHaveBeenCalled();
});

it('PA02 can disable an existing task after its model was removed', async () => {
  const f = draft(); f.id = 'obsolete'; f.agentConfig!.model = { provider_id: 'removed', model: 'removed' };
  await toggleCoreSchedule(f, { personalId: 'pa_a' });
  expect(api).toHaveBeenCalledWith('PUT', '/api/cron/jobs/obsolete', { enabled: false });
  f.enabled = false; await expect(toggleCoreSchedule(f, { personalId: 'pa_a' })).rejects.toThrow('Lom账号模型');
});
it('PA-HEARTBEAT persists a reconciliation marker only for the personal default creation path',async()=>{
 const f=draft();f.scheduleDescription='lom:personal-heartbeat:v1:pa_a:daily';const dispatched=vi.fn();
 await saveCoreSchedule(f,undefined,{personalId:'pa_a',beforeCreate:dispatched});
 expect(dispatched).toHaveBeenCalledTimes(1);
 expect(api).toHaveBeenCalledWith('POST','/api/cron/jobs',expect.objectContaining({description:f.scheduleDescription,conversation_id:'assistant',created_by:'user'}));
});

function sharedTierAssistants() {
  S.cloudAllowed = null; S.cloudExtra = []; S.cloudLegacy = {};
  S.cloudModels = { pro: 'shared', max: 'shared', mini: 'mini' };
  S.providers[0].models = ['shared','mini']; S.model = 'lom-mini';
  S.convs = ['a','b'].map((id,i) => ({ id: `conv-${id}`, owner: 'pc', title: id, updated: 1, messages: [],
    modelId: 'cloud::shared', providerId: 'cloud', lomTier: i ? 'max' as const : 'pro' as const,
    personal: { id: `pa_${id}`, name: id, directory: `/${id}` } }));
  for (const id of ['a','b']) storeAssistant({ id: `pa_${id}`, name: id, directory: `/${id}`, workspace: `/${id}`, conversation: `conv-${id}` });
}
it.each(['create','edit','enable'])('PA-CRON-01 both personal assistants can %s jobs when Pro and Max share a model', async action => {
  sharedTierAssistants();
  for (const id of ['a','b']) {
    const f = { ...draft(), conversationId: `conv-${id}`, enabled: action !== 'enable', runMode: 'yolo',
      agentConfig: { name: id, assistant_id: 'lom', workspace: `/${id}`, mode:'default', model: { provider_id:'cloud', model:'shared' } } };
    if (action === 'enable') await toggleCoreSchedule({ ...f, id: `job-${id}` }, { personalId:`pa_${id}` });
    else await saveCoreSchedule(f, action === 'edit' ? `job-${id}` : undefined, { personalId:`pa_${id}` });
  }
  const writes = vi.mocked(api).mock.calls.filter(([method,path]) => method !== 'GET' && path.startsWith('/api/cron/jobs'));
  expect(writes).toHaveLength(2);
  if(action === 'create') expect(writes.map(call => (call[2] as any).conversation_id)).toEqual(['conv-a','conv-b']);
  if(action === 'edit') expect(writes.map(call => (call[2] as any).agent_config.workspace)).toEqual(['/a','/b']);
  if(action === 'enable') expect(writes.map(call => call[1])).toEqual(['/api/cron/jobs/job-a','/api/cron/jobs/job-b']);
});
it('PA-CRON-01 a preceding user assistant cannot replace the native personal cron identity',async()=>{
  vi.mocked(api).mockImplementation(async (method,path) => {
    if(path==='/api/assistants') return [
      {id:'unrelated',source:'user',enabled:true,agent:{type:'aionrs'}},
      {id:'native-lom',source:'generated',enabled:true,agent:{type:'aionrs'}},
    ] as never;
    return (method==='POST'?{id:'created'}:[]) as never;
  });
  await saveCoreSchedule(draft(),undefined,{personalId:'pa_a'});
  expect(api).toHaveBeenCalledWith('POST','/api/cron/jobs',expect.objectContaining({agent_config:expect.objectContaining({assistant_id:'native-lom'})}));
});
it('PA-CRON-01 ambiguous native assistant candidates fail before creation',async()=>{
  vi.mocked(api).mockResolvedValue([{id:'one',source:'generated',enabled:true,agent:{type:'aionrs'}},{id:'two',source:'generated',enabled:true,agent:{type:'aionrs'}}] as never);
  await expect(saveCoreSchedule(draft(),undefined,{personalId:'pa_a'})).rejects.toThrow('确认');
  expect(vi.mocked(api).mock.calls.some(([method])=>method==='POST')).toBe(false);
});
it('PA-CRON-01 a stored tier cannot reinterpret a BYOK model as a Lom model',async()=>{
  sharedTierAssistants();S.providers.push({id:'own',name:'Own key',enabled:true,models:['shared']} as any);
  const f={...draft(),conversationId:'conv-b',agentConfig:{model:{provider_id:'own',model:'shared'}}};
  await expect(saveCoreSchedule(f,undefined,{personalId:'pa_b'})).rejects.toThrow('Lom账号模型');
  expect(api).not.toHaveBeenCalled();
});
it('PA-CRON-01 a model-less personal draft uses its owner rather than the active global model',async()=>{
  sharedTierAssistants();
  const f={...draft(),conversationId:'conv-b',agentConfig:{name:'b',workspace:'/b'}};
  await saveCoreSchedule(f,undefined,{personalId:'pa_b'});
  expect(api).toHaveBeenCalledWith('POST','/api/cron/jobs',expect.objectContaining({conversation_id:'conv-b',agent_config:expect.objectContaining({model:{provider_id:'cloud',model:'shared'},workspace:'/b'})}));
});

it('PA-CRON-01 an assistant with unknown source cannot be treated as the native engine',async()=>{
  vi.mocked(api).mockResolvedValue([{id:'unknown',enabled:true,agent:{type:'aionrs'}}] as never);
  await expect(saveCoreSchedule(draft(),undefined,{personalId:'pa_a'})).rejects.toThrow('确认');
  expect(vi.mocked(api).mock.calls.some(([method])=>method==='POST')).toBe(false);
});
