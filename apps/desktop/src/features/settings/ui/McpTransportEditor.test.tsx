import { useState, act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect,it } from 'vitest';
import { McpTransportEditor } from './McpTransportEditor';
it('HUB-01 credentials and raw JSON stay hidden until advanced configuration is opened',async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  const host=document.createElement('div'),root=createRoot(host);
  function Fixture(){const [value,setValue]=useState(JSON.stringify({type:'http',url:'https://example.com/mcp',headers:{Authorization:'fixture-secret'}}));return <McpTransportEditor value={value} onChange={setValue} disabled={false}/>;}
  try{
    await act(async()=>root.render(<Fixture/>));
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.innerHTML).not.toContain('fixture-secret');
    expect(host.querySelector('input')?.value).toBe('https://example.com/mcp');
    await act(async()=>host.querySelector('button')!.click());
    expect(host.querySelector('textarea')?.value).toContain('fixture-secret');
  }finally{await act(async()=>root.unmount());}
});

it('HUB-01 malformed advanced arguments remain editable instead of crashing the basic form',async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  const host=document.createElement('div'),root=createRoot(host);
  const value=JSON.stringify({type:'stdio',command:'example',args:'wrong-shape'});
  try {await act(async()=>root.render(<McpTransportEditor value={value} onChange={()=>{}} disabled={false}/>));expect(host.querySelector('textarea')?.value).toBe(value);}
  finally {await act(async()=>root.unmount());}
});
