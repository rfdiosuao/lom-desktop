import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({history:vi.fn(),docs:vi.fn(),schedules:vi.fn(),watch:vi.fn(),cache:vi.fn(),pending:vi.fn()}));
vi.mock('./phoneChat',()=>({syncPhoneHistory:m.history,watchPhone:m.watch}));
vi.mock('./phoneDocuments',()=>({syncPhoneDocuments:m.docs}));
vi.mock('./phoneSchedules',()=>({syncPhoneSchedules:m.schedules,resolvePendingPhoneRuns:m.pending}));
vi.mock('./phoneCache',()=>({loadPhoneCache:m.cache}));
import { S } from '@/state/store';
import { tickPhoneSync, phoneSyncError } from './phoneSync';
let account=0;
beforeEach(()=>{
 vi.resetAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-16T00:00:00Z'));
 S.account={id:`sync-${++account}`} as typeof S.account; S.cloud='signed-in';S.phoneId='a';S.phoneOrder=['a','b','c'];
 for(const id of S.phoneOrder) S.agents[id]={id,name:id,real:true,status:'online'} as typeof S.agents[string];
 Object.defineProperty(document,'hidden',{configurable:true,value:false});
 m.history.mockResolvedValue(false);m.docs.mockResolvedValue(undefined);m.schedules.mockResolvedValue(undefined);m.pending.mockResolvedValue(undefined);
});
afterEach(()=>vi.useRealTimers());
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
