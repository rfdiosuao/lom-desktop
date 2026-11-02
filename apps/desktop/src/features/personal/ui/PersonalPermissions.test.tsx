import { beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { S } from '@/state/store';
import { storeAssistant } from '../runtime/catalog';
import { PersonalPermissions } from './PersonalPermissions';
vi.mock('@/core/client', async load => ({ ...await load<typeof import('@/core/client')>(), api: vi.fn(async () => ({})) }));
const assistant = { id: 'pa_a', name: 'A', directory: '/a', workspace: '/a' };
beforeEach(() => { localStorage.clear(); S.account = { id: 'a', name: '', email: '' }; S.cloud = 'signed-in'; S.running = {}; storeAssistant(assistant); });
it('PA-PERM-01 exposes local choices and states capability limits', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<PersonalPermissions assistant={assistant} />));
    const select = host.querySelector<HTMLSelectElement>('[aria-label="助理权限档位"]');
    expect(select?.value).toBe('routine');
    await act(async () => { select!.value = 'ask'; select!.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(select?.value).toBe('ask');
    expect(host.textContent).toContain('文件写入、执行命令仍需询问');
  } finally { await act(async () => root.unmount()); }
});
it('PA-PERM-01 full access is a real selectable choice and can be switched back',async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  const host=document.createElement('div'),root=createRoot(host);
  try {
    await act(async()=>root.render(<PersonalPermissions assistant={assistant}/>));
    const select=host.querySelector('select')!;
    await act(async()=>{select.value='full';select.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(select.value).toBe('full');expect(host.textContent).toContain('不再逐项询问');
    expect(host.textContent).not.toContain('完全访问（受限）');
    await act(async()=>{select.value='ask';select.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(select.value).toBe('ask');
  }finally{await act(async()=>root.unmount());}
});
