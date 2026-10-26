import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { ScreenFrame } from '@/core/remoteWire';
const m=vi.hoisted(()=>({ capture:vi.fn(), save:vi.fn(), supervise:vi.fn() }));
vi.mock('../runtime/phoneScreen',()=>({capturePhone:m.capture,saveScreen:m.save,screenError:(e:Error)=>e.message}));
vi.mock('@/features/chat/actions/composer',()=>({superviseNow:m.supervise}));
const {PhoneScreen}=await import('./PhoneScreen');
let host:HTMLDivElement,root:Root;
const frame=(image:string):ScreenFrame=>({image,mime:'image/jpeg',width:'1080',height:'2400',captured_at:'123'});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{vi.useFakeTimers();vi.resetAllMocks();S.cloud='signed-in';S.account={id:'a'} as typeof S.account;S.live=true;S.layout.rightCollapsed=false;S.modals=[];S.agents.dev_a={...S.agents.p1,id:'dev_a',real:true,status:'online'};S.agents.dev_b={...S.agents.dev_a,id:'dev_b'};host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();});
it('R02-03 with reconnect off hides stale image on capture failure and stops polling until explicit retry',async()=>{
 S.prefs.reconnect = false;
 m.capture.mockResolvedValueOnce(frame('AAA')).mockRejectedValue(new Error('capture failed'));
 await act(async()=>root.render(<PhoneScreen device="dev_a"/>));expect(host.querySelector('img')?.src).toContain('AAA');
 await act(async()=>vi.advanceTimersByTimeAsync(1000));expect(host.querySelector('img')).toBeNull();expect(host.textContent).toContain('capture failed');
 await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(m.capture).toHaveBeenCalledTimes(2);
});
it('R02-03 ignores late response after switching phones and pauses without new requests',async()=>{
 let oldReply!:(value:ScreenFrame)=>void;
 m.capture.mockImplementation((id:string)=>id==='dev_a'?new Promise<ScreenFrame>(r=>{oldReply=r;}):Promise.resolve(frame('BBB')));
 await act(async()=>root.render(<PhoneScreen device="dev_a"/>));
 await act(async()=>root.render(<PhoneScreen device="dev_b"/>));await act(async()=>oldReply(frame('AAA')));
 expect(host.querySelector('img')?.src).toContain('BBB');
 await act(async()=>update(s=>{s.live=false;}));await act(async()=>vi.advanceTimersByTimeAsync(5000));
 expect(host.querySelector('img')).toBeNull();expect(m.capture).toHaveBeenCalledTimes(2);
});

it('R02-03 closing the workspace stops refresh even when the panel remains mounted',async()=>{
 m.capture.mockResolvedValue(frame('AAA'));
 await act(async()=>root.render(<PhoneScreen device="dev_a"/>));
 await act(async()=>update(s=>{s.layout.rightCollapsed=true;}));
 await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(m.capture).toHaveBeenCalledTimes(1);
});

it('D10 reconnect retries with backoff and turning it off cancels pending retries', async () => {
 S.prefs.reconnect = true;
 m.capture.mockRejectedValueOnce(new Error('temporary network failure')).mockResolvedValue(frame('NEW'));
 await act(async () => root.render(<PhoneScreen device="dev_a" />));
 expect(m.capture).toHaveBeenCalledTimes(1);
 await act(async () => vi.advanceTimersByTimeAsync(1999)); expect(m.capture).toHaveBeenCalledTimes(1);
 await act(async () => vi.advanceTimersByTimeAsync(1)); expect(host.querySelector('img')?.src).toContain('NEW');
 m.capture.mockRejectedValue(new Error('offline'));
 await act(async () => vi.advanceTimersByTimeAsync(1000));
 await act(async () => update(s => { s.prefs.reconnect = false; }));
 const count = m.capture.mock.calls.length;
 await act(async () => vi.advanceTimersByTimeAsync(30000)); expect(m.capture).toHaveBeenCalledTimes(count);
});
it('D10 missing phone permission never triggers an endless automatic retry', async () => {
 S.prefs.reconnect = true; m.capture.mockRejectedValue(new Error('screen.permission_required'));
 await act(async () => root.render(<PhoneScreen device="dev_a" />));
 await act(async () => vi.advanceTimersByTimeAsync(60000)); expect(m.capture).toHaveBeenCalledTimes(1);
});
