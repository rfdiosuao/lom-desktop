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
    if (path === '/api/assistants') return [{ id: 'lom', enabled: true, agent: { type: 'aionrs' } }] as never;
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
  vi.mocked(api).mockImplementation(async (_method, path) => { if (path === '/api/assistants') { beginAuthChange(); return [{ id: 'lom', enabled: true, agent: { type: 'aionrs' } }] as never; } return [] as never; });
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
