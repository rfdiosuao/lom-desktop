import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import { initialState } from '@/state/state';
import { Shell } from './Shell';
import { resetLayout } from './layout';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const openFolder = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/features/workspace/runtime/workspace', async original => ({ ...await original<typeof import('@/features/workspace/runtime/workspace')>(), openInSystem: openFolder }));
let host: HTMLDivElement, root: Root;
beforeEach(async()=>{
  Object.assign(S,initialState()); S.route={name:'home'}; S.mode='desktop';
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root.render(<Shell/>));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('UI-WORKBENCH-01 collapsed workspace stays inert and restores its current tab',async()=>{
  await act(async()=>update(s=>{s.wsTab='files';}));
  const toggle=()=>host.querySelector<HTMLButtonElement>('[aria-label*="工作区（"]')!;
  await act(async()=>toggle().click());
  expect(host.querySelector('[aria-label="工作区"]')?.closest('[inert]')).not.toBeNull();
  await act(async()=>toggle().click());
  expect(host.querySelector('[aria-label="工作区"]')?.closest('[inert]')).toBeNull();
  expect(S.wsTab).toBe('files');expect(host.querySelector('[aria-label="筛选文件"]')).not.toBeNull();
});
it('UI-WORKBENCH-01 compact Agent control opens the existing switch menu',async()=>{
  const button=host.querySelector<HTMLButtonElement>('[aria-label^="当前 Agent："]')!;
  expect(button.getAttribute('aria-haspopup')).toBe('menu');
  await act(async()=>button.click());
  expect(S.menu?.id).toBe('agentSwitch');
});
it('UI-WORKBENCH-01 width keyboard controls and reset preserve usable defaults',async()=>{
  const divider=host.querySelector('[aria-label="调整工作区宽度"]')!;
  await act(async()=>divider.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})));
  expect(S.layout.right).toBe(536);
  await act(async()=>divider.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
  expect(S.layout.rightCollapsed).toBe(true);
  await act(async()=>resetLayout());expect(S.layout.right).toBe(520);expect(S.layout.rightCollapsed).toBe(false);
});

it('UI-HEADER-01 folder shortcut uses the active workspace and is disabled without a folder',async()=>{
  const folder=()=>host.querySelector<HTMLButtonElement>('[aria-label="打开工作区文件夹"]')!;
  expect(folder().disabled).toBe(true);
  await act(async()=>update(s=>{s.folder='/test/workspace';}));
  expect(folder().disabled).toBe(false);
  await act(async()=>folder().click());
  expect(openFolder).toHaveBeenCalledWith('/test/workspace');
});
