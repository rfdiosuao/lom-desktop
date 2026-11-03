import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect,it } from 'vitest';
import { ProfileEditor } from './ProfileEditor';
import { S } from '@/state/store';
import { readProfile } from '../runtime/profiles';
it('HUB-01 local users can preview, apply and disable a profile without signing in',async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  localStorage.clear(); S.cloud='signed-out'; S.account=null; S.agentCatalog=[];
  const host=document.createElement('div'),root=createRoot(host);
  const click=async(label:string)=>{await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===label)!.click());};
  try {
    await act(async()=>root.render(<ProfileEditor/>));
    await act(async()=>{const select=host.querySelectorAll('select')[1];select.value='代码审查员';select.dispatchEvent(new Event('change',{bubbles:true}));});
    await click('预览配置');
    expect(readProfile('pc').current).toBeNull();
    await click('应用配置');expect(readProfile('pc').current?.name).toBe('代码审查员');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('新建任务');
    await click('预览配置');await click('停用专业配置');expect(readProfile('pc').current).toBeNull();
  } finally {await act(async()=>root.unmount());localStorage.clear();}
});
