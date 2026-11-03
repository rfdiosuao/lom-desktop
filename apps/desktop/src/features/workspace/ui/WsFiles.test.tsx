import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import { initialState } from '@/state/state';
import { WsFiles } from './WsFiles';
const mock = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/core/client', async original => ({ ...await original<typeof import('@/core/client')>(), api: mock.read }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(async () => {
  Object.assign(S, initialState()); S.folder='/test';
  S.files={name:'test',path:'/test',type:'dir',children:[{name:'docs',path:'/test/docs',type:'dir',children:[{name:'guide.md',path:'/test/docs/guide.md',type:'file'}]},{name:'README.md',path:'/test/README.md',type:'file'}]};
  S.treeOpen={'/test':true,'/test/docs':true};
  mock.read.mockResolvedValue('file contents');
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root.render(<WsFiles/>));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.clearAllMocks();});
const button=(label:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===label || b.getAttribute('aria-label')===label)!;
async function filter(value:string){
  const input=host.querySelector('input')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
}
it('UI-WORKBENCH-01 file selection preserves directory and closing restores the empty reader',async()=>{
  await act(async()=>button('guide.md').click());
  expect(host.querySelector('[aria-label="文件内容"]')?.textContent).toContain('file contents');
  expect(button('guide.md').getAttribute('aria-current')).toBe('true');
  expect(button('README.md')).toBeDefined();
  await act(async()=>button('关闭文件预览').click());
  expect(host.textContent).toContain('选择一个文件');expect(button('README.md')).toBeDefined();
});
it('UI-WORKBENCH-01 filtering reveals matching descendants and clearing preserves folder state',async()=>{
  await act(async()=>button('docs').click());
  expect(button('guide.md')).toBeUndefined();
  await filter('GUIDE');expect(button('guide.md')).toBeDefined();expect(button('README.md')).toBeUndefined();
  await filter('not-found');expect(host.textContent).toContain('没有匹配的文件');
  await filter('');expect(button('guide.md')).toBeUndefined();expect(button('README.md')).toBeDefined();
  await filter('guide');await act(async()=>update(s=>{s.folder='/other';}));
  expect(host.querySelector('input')?.value).toBe('');
});
it('UI-WORKBENCH-01 real read failure stays visible with directory available',async()=>{
  mock.read.mockRejectedValue(new Error('文件不存在'));
  await act(async()=>button('guide.md').click());
  expect(host.querySelector('[aria-label="文件内容"]')?.textContent).toContain('文件不存在');
  expect(button('README.md')).toBeDefined();
});
