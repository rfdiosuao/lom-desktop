import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect,it,vi } from 'vitest';
vi.hoisted(() => vi.stubEnv('VITE_LOM_CONNECTOR_URL', 'https://connectors.example.invalid/mcp'));
vi.mock('./ProfileEditor',()=>({ProfileEditor:({initial}:any)=><p>编辑：{initial.name}</p>}));
vi.mock('@/features/settings/ui/McpModal',()=>({McpManager:({initialServer}:any)=><p>配置：{initialServer?.name || '全部'}</p>}));
vi.mock('@/features/settings/runtime/mcpManager',async original=>({...await original<typeof import('@/features/settings/runtime/mcpManager')>(),listMcp:vi.fn(async()=>[{id:'one',name:'文档工具',enabled:true,last_test_status:'connected',transport:{type:'http'}},{id:'private',name:'内部',builtin:true,transport:{type:'stdio'}},{id:'ap',name:'Activepieces',transport:{type:'http',url:'https://connectors.example.invalid/mcp/'}}]),protectedMcp:(r:any)=>!!r.builtin,mcpStatusLabel:()=> '连接成功'}));
import { PROFILE_TEMPLATES } from '../runtime/profiles';
import { AgentProfiles } from './AgentProfiles';
import { Plugins } from './Plugins';
it('HUB-01 directory opens the selected role only after applying, supports returning and search',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div'),root=createRoot(host);
 try{
  await act(async()=>root.render(<AgentProfiles/>));expect(host.querySelector('textarea')).toBeNull();expect(host.querySelectorAll('article')).toHaveLength(PROFILE_TEMPLATES.length);
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="应用 代码审查员"]')!.click());expect(host.textContent).toContain('编辑：代码审查员');
  await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='返回智能体')!.click());expect(host.querySelectorAll('article')).toHaveLength(PROFILE_TEMPLATES.length);
  await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='质量保障')!.click());
  expect([...host.querySelectorAll('h3')].map(e=>e.textContent)).toEqual(['代码审查员','测试工程师']);
  await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='全部')!.click());
  await act(async()=>root.render(<AgentProfiles query="运维"/>));expect(host.querySelectorAll('article')).toHaveLength(1);
 }finally{await act(async()=>root.unmount());}
});
it('HUB-01 plugin directory shows real user services and opens only the selected configuration',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div'),root=createRoot(host);
 try{
  await act(async()=>root.render(<Plugins/>));expect([...host.querySelectorAll('article h3')].map(el => el.textContent)).toEqual(['GitHub', 'Google Drive', 'Slack', '文档工具']);expect(host.textContent).not.toContain('内部');expect(host.textContent).not.toContain('Activepieces');
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="连接 文档工具"]')!.click());expect(host.textContent).toContain('配置：文档工具');
 }finally{await act(async()=>root.unmount());}
});
