import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { AssistantAvatar } from './AssistantAvatar';
const IMAGE='data:image/jpeg;base64,AAAA';
it('PA-AVATAR-01 shows the custom image and falls back to the preset then the default when it cannot load',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);
 try{
  await act(async()=>root.render(<AssistantAvatar assistant={{avatar:'03',avatarImage:IMAGE}} alt="小麓" />));
  const image=()=>host.querySelector('img')!;
  expect(image().getAttribute('src')).toBe(IMAGE);expect(image().dataset.avatar).toBe('custom');expect(image().alt).toBe('小麓');
  await act(async()=>{image().dispatchEvent(new Event('error'));});
  expect(image().getAttribute('src')).toBe('/mascots/deer-03.png');expect(image().dataset.avatar).toBe('preset');
  await act(async()=>{image().dispatchEvent(new Event('error'));});
  expect(image().getAttribute('src')).toBe('/mascots/deer-06.png');
 }finally{await act(async()=>root.unmount());}
});
