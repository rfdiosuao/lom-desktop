import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({history:vi.fn(),docs:vi.fn(),schedules:vi.fn(),watch:vi.fn(),cache:vi.fn(),pending:vi.fn()}));
vi.mock('./phoneChat',()=>({syncPhoneHistory:m.history,watchPhone:m.watch}));
vi.mock('./phoneDocuments',()=>({syncPhoneDocuments:m.docs}));
vi.mock('./phoneSchedules',()=>({syncPhoneSchedules:m.schedules,resolvePendingPhoneRuns:m.pending}));
vi.mock('./phoneCache',()=>({loadPhoneCache:m.cache}));
import { S } from '@/state/store';
import { tickPhoneSync, phoneSyncError, stopPhoneSync } from './phoneSync';
let account=0;
beforeEach(()=>{
 vi.resetAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-16T00:00:00Z'));
 S.account={id:`sync-${++account}`} as typeof S.account; S.cloud='signed-in';S.phoneId='a';S.phoneOrder=['a','b','c'];
 for(const id of S.phoneOrder) S.agents[id]={id,name:id,real:true,status:'online'} as typeof S.agents[string];
 Object.defineProperty(document,'hidden',{configurable:true,value:false});
 m.history.mockResolvedValue(false);m.docs.mockResolvedValue(undefined);m.schedules.mockResolvedValue(undefined);m.pending.mockResolvedValue(undefined);
});
afterEach(()=>{stopPhoneSync();vi.useRealTimers();});
it('D09 所有手机轮流同步、同一时刻最多两台、定时同步不会重复请求',async()=>{
 const release:(()=>void)[]=[];m.history.mockImplementation(()=>new Promise<void>(resolve=>release.push(resolve)));
 const running=tickPhoneSync();await Promise.resolve();expect(m.history.mock.calls.map(x=>x[0])).toEqual(['a','b']);
 await tickPhoneSync();expect(m.history).toHaveBeenCalledTimes(2);release.forEach(x=>x());await running;
 m.history.mockResolvedValue(false);await tickPhoneSync();expect(m.history.mock.calls.map(x=>x[0])).toEqual(['a','b','c']);
 await tickPhoneSync();expect(m.history).toHaveBeenCalledTimes(3);expect(m.docs).toHaveBeenCalledTimes(3);expect(m.schedules).toHaveBeenCalledTimes(3);
 vi.advanceTimersByTime(15000);await tickPhoneSync();expect(m.history).toHaveBeenLastCalledWith('a',true);
});
it('D09 单台失败指数退避，不阻断其他手机，切换账号后重新同步',async()=>{
 m.history.mockImplementation(async(id:string)=>{if(id==='a')throw new Error('offline');return false;});
 await tickPhoneSync();await tickPhoneSync();expect(phoneSyncError('a')).toBe('offline');expect(m.schedules).toHaveBeenCalledWith('c');
 vi.advanceTimersByTime(15000);await tickPhoneSync();expect(m.history.mock.calls.filter(x=>x[0]==='a')).toHaveLength(2);
 vi.advanceTimersByTime(15000);await tickPhoneSync();expect(m.history.mock.calls.filter(x=>x[0]==='a')).toHaveLength(2);
 S.account={id:'new-account'} as typeof S.account;m.history.mockResolvedValue(false);await tickPhoneSync();expect(phoneSyncError('a')).toBe('');
 expect(m.history).toHaveBeenCalledWith('a',false);
});
it('PHONE-RECONNECT-01 online recovery immediately clears the previous failure backoff', async () => {
 S.prefs.reconnect=true; S.phoneOrder=['a'];
 m.history.mockRejectedValue(new Error('relay.offline'));
 await tickPhoneSync(); vi.advanceTimersByTime(15000); await tickPhoneSync();
 expect(m.history).toHaveBeenCalledTimes(2);
 S.agents.a.status='offline';await tickPhoneSync();
 S.agents.a.status='online';m.history.mockResolvedValue(false);
 await tickPhoneSync();
 expect(m.history).toHaveBeenCalledTimes(3);expect(phoneSyncError('a')).toBe('');
});
it('PHONE-RECONNECT-01 resume clears stale backoff but respects disabled automatic recovery',async()=>{
 const {resumePhoneSync}=await import('./phoneSync');S.phoneOrder=['a'];S.prefs.reconnect=true;
 m.history.mockRejectedValueOnce(new Error('offline'));await tickPhoneSync();
 m.history.mockResolvedValue(false);S.prefs.reconnect=false;await resumePhoneSync();expect(m.history).toHaveBeenCalledTimes(1);
 S.prefs.reconnect=true;await resumePhoneSync();expect(m.history).toHaveBeenCalledTimes(2);
});
it('PHONE-RECONNECT-01 explicit recovery targets the requested phone without replaying pending operations',async()=>{
 const {syncPhoneNow}=await import('./phoneSync');S.prefs.reconnect=false;
 expect(await syncPhoneNow('b')).toBe(true);expect(m.history).toHaveBeenCalledWith('b',false);
 expect(m.pending).not.toHaveBeenCalled();
});
it('PHONE-RECONNECT-01 a stale in-flight sync cannot continue its later stages after disconnect/reconnect',async()=>{
 S.phoneOrder=['a'];S.prefs.reconnect=true;
 let finish!:()=>void;m.history.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
 const old=tickPhoneSync();await Promise.resolve();
 S.agents.a.status='offline';await tickPhoneSync();S.agents.a.status='online';await tickPhoneSync();
 finish();await old;expect(m.docs).not.toHaveBeenCalled();
 await tickPhoneSync();expect(m.history).toHaveBeenCalledTimes(2);expect(m.docs).toHaveBeenCalledTimes(1);
});

it('PHONE-RECONNECT-01 a long timer gap recovers after sleep even without an online or visibility event',async()=>{
 const {startPhoneSync}=await import('./phoneSync');S.phoneOrder=['a'];S.prefs.reconnect=true;
 m.history.mockRejectedValue(new Error('offline'));await tickPhoneSync();vi.advanceTimersByTime(15000);await tickPhoneSync();
 startPhoneSync();m.history.mockResolvedValue(false);
 vi.setSystemTime(Date.now()+20000);await vi.advanceTimersByTimeAsync(2000);
 expect(m.history).toHaveBeenCalledTimes(3);expect(phoneSyncError('a')).toBe('');
});
