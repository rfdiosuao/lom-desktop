import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import {S} from '@/state/store';
const m=vi.hoisted(()=>({cloud:vi.fn()}));
vi.mock('@/features/account/runtime/cloud',()=>({cloud:m.cloud}));
import {syncDevices,startDevicesTimer,stopDevicesTimer,refreshDevicesNow} from '@/features/phones/runtime/devices';
import {beginAuthChange} from '@/features/account/runtime/authScope';
beforeEach(()=>{
 vi.useFakeTimers();vi.clearAllMocks();stopDevicesTimer();
 S.cloud='signed-in';S.account={id:'a',name:'A',email:''};S.phoneOrder=[];
 Object.defineProperty(document,'hidden',{configurable:true,value:false});m.cloud.mockResolvedValue([]);
});
afterEach(()=>{stopDevicesTimer();vi.useRealTimers();});
it('PHONE-RECONNECT-01 starts one poller and refreshes on desktop network/visibility wake',async()=>{
 startDevicesTimer();startDevicesTimer();expect(vi.getTimerCount()).toBe(1);
 window.dispatchEvent(new Event('online'));await Promise.resolve();await Promise.resolve();expect(m.cloud).toHaveBeenCalledTimes(1);
 await syncDevices();m.cloud.mockClear();document.dispatchEvent(new Event('visibilitychange'));await syncDevices();
 expect(m.cloud).toHaveBeenCalledTimes(1);
});
it('PHONE-RECONNECT-01 wake joining an old request gets a fresh snapshot after it settles',async()=>{
 let finish!:(value:unknown[])=>void;m.cloud.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const old=syncDevices();const wake=refreshDevicesNow();expect(m.cloud).toHaveBeenCalledTimes(1);
 finish([]);await old;await wake;expect(m.cloud).toHaveBeenCalledTimes(2);
});
it('PHONE-RECONNECT-01 an account change cancels queued wake recovery',async()=>{
 let finish!:(value:unknown[])=>void;m.cloud.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const old=syncDevices();const wake=refreshDevicesNow();beginAuthChange();S.account={id:'b',name:'B',email:''};
 finish([]);await old;await wake;expect(m.cloud).toHaveBeenCalledTimes(1);
});
