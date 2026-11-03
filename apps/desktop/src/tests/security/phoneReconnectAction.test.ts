import { beforeEach,expect, it, vi } from 'vitest';
import { S } from '@/state/store';
const m=vi.hoisted(()=>({refresh:vi.fn(),sync:vi.fn(),toast:vi.fn()}));
vi.mock('@/features/phones/runtime/devices',()=>({refreshDevicesNow:m.refresh,dropPhone:vi.fn(),removeDevice:vi.fn(),renameDevice:vi.fn()}));
vi.mock('@/features/phones/runtime/phoneSync',()=>({syncPhoneNow:m.sync,phoneSyncError:()=>''}));
vi.mock('@/shared/overlays/controller',()=>({toast:m.toast,toastError:vi.fn(),openModal:vi.fn(),closeModal:vi.fn(),confirm:vi.fn(),prompt:vi.fn(),topModal:vi.fn()}));
import {beginAuthChange} from '@/features/account/runtime/authScope';
import { reconnect } from '@/features/phones/actions/phone';
beforeEach(()=>{vi.resetAllMocks();S.cloud='signed-in';S.account={id:'a',name:'A',email:''};S.agents.dev_a={id:'dev_a',kind:'phone',name:'Phone',persona:'',real:true,status:'online'};});
it('PHONE-RECONNECT-01 reconnect actually probes the requested phone instead of only showing a toast',async()=>{
 S.cloud='signed-in';S.account={id:'a',name:'A',email:''};S.phoneId='other';
 S.agents.dev_a={id:'dev_a',kind:'phone',name:'Phone',persona:'',real:true,status:'online'};
 m.refresh.mockResolvedValue(undefined);m.sync.mockResolvedValue(true);
 await reconnect('dev_a');
 expect(m.refresh).toHaveBeenCalledTimes(1);expect(m.sync).toHaveBeenCalledWith('dev_a');
});
it('PHONE-RECONNECT-01 offline phone does not receive a probe or a false connected notice',async()=>{
 S.agents.dev_a.status='offline';m.refresh.mockResolvedValue(undefined);
 await reconnect('dev_a');expect(m.sync).not.toHaveBeenCalled();expect(m.toast.mock.calls[0][0]).toContain('仍离线');
});
it('PHONE-RECONNECT-01 account changes during refresh cannot continue an old recovery',async()=>{
 m.refresh.mockImplementation(async()=>{beginAuthChange();S.account={id:'b',name:'B',email:''};});
 await reconnect('dev_a');expect(m.sync).not.toHaveBeenCalled();expect(m.toast).not.toHaveBeenCalled();
});
