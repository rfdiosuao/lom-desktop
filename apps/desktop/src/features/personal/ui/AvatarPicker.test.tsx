import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AvatarPicker } from './AvatarPicker';
it('PA-AVATAR shows six images, defaults to 06 and selects an alternative',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);const choose=vi.fn();
 try{await act(async()=>root.render(<AvatarPicker onChange={choose}/>));
 const radios=host.querySelectorAll<HTMLInputElement>('input[type=radio]');expect(radios).toHaveLength(6);expect(radios[5].checked).toBe(true);expect(host.querySelectorAll('img')).toHaveLength(6);
 await act(async()=>radios[0].click());expect(choose).toHaveBeenCalledWith('01');expect(radios[0].checked).toBe(true);expect(radios[5].checked).toBe(false);
 }finally{await act(async()=>root.unmount());}
});
