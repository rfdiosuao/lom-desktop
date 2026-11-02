import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { api } from '@/core/client';
import { storeAssistant } from './catalog';
import { ensureHeartbeats } from './heartbeats';
import { saveCoreSchedule } from '@/features/schedules/runtime/schedules';
vi.mock('@/core/client', async load => ({ ...await load<typeof import('@/core/client')>(), api: vi.fn() }));
vi.mock('@/features/schedules/runtime/schedules',()=>({saveCoreSchedule:vi.fn(async()=>{})}));
const a={id:'pa_a',name:'小麓',directory:'/a',workspace:'/a',conversation:'conv'};
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();S.cloud='signed-in';S.account={id:'owner',name:'',email:''};
 S.convs=[{id:'conv',title:'',owner:'pc',messages:[],updated:1,modelId:'cloud::pro',providerId:'cloud',personal:{id:'pa_a',name:'小麓',directory:'/a'}}];storeAssistant(a);vi.mocked(api).mockResolvedValue([]);vi.mocked(saveCoreSchedule).mockImplementation(async (_f,_id,scope)=>{scope?.beforeCreate?.();});
});
it('PA-HEARTBEAT installs three silent default jobs once, with precise local cron times',async()=>{
 await Promise.all([ensureHeartbeats(a),ensureHeartbeats(a)]);await ensureHeartbeats(a);
 expect(saveCoreSchedule).toHaveBeenCalledTimes(3);
 const calls=vi.mocked(saveCoreSchedule).mock.calls;
 expect(calls.map(c=>c[0].cron)).toEqual(['0 22 * * *','0 3 * * SUN','0 9 1 * *']);
 for(const [job,,scope] of calls){expect(job.conversationId).toBe('conv');expect(job.runMode).toBe('default');expect(job.prompt).toContain('不发送');expect(scope).toEqual(expect.objectContaining({personalId:'pa_a'}));}
});
it('PA-HEARTBEAT unknown create outcome never automatically repeats a job',async()=>{
 vi.mocked(saveCoreSchedule).mockImplementationOnce(async (_f,_id,scope)=>{scope?.beforeCreate?.();throw new Error('timeout');});
 await expect(ensureHeartbeats(a)).rejects.toThrow('timeout');await expect(ensureHeartbeats(a)).rejects.toThrow('待核对');expect(saveCoreSchedule).toHaveBeenCalledTimes(1);
});
it('PA-HEARTBEAT reconciles existing default marker without reenabling or overwriting it',async()=>{
 vi.mocked(api).mockResolvedValue([{description:'lom:personal-heartbeat:v1:pa_a:daily',metadata:{conversation_id:'conv'},enabled:false}]);await ensureHeartbeats(a);expect(saveCoreSchedule).toHaveBeenCalledTimes(2);
});
it('PA-HEARTBEAT preflight failures before dispatch remain retryable',async()=>{
 vi.mocked(saveCoreSchedule).mockRejectedValueOnce(new Error('model unavailable'));
 await expect(ensureHeartbeats(a)).rejects.toThrow('model unavailable');await ensureHeartbeats(a);expect(saveCoreSchedule).toHaveBeenCalledTimes(4);
});
it('PA-HEARTBEAT account changes after listing do not create a task',async()=>{
 vi.mocked(api).mockImplementationOnce(async()=>{S.account={id:'different',name:'',email:''};return [] as never;});
 await expect(ensureHeartbeats(a)).rejects.toThrow('账号已切换');expect(saveCoreSchedule).not.toHaveBeenCalled();
});
it('PA-HEARTBEAT explicitly confirmed recovery may recreate a missing unknown job',async()=>{
 vi.mocked(saveCoreSchedule).mockImplementationOnce(async (_f,_id,scope)=>{scope?.beforeCreate?.();throw new Error('timeout');});
 await expect(ensureHeartbeats(a)).rejects.toThrow('timeout');await ensureHeartbeats(a,true);expect(saveCoreSchedule).toHaveBeenCalledTimes(4);
});
