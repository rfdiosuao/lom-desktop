import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
vi.mock('@/features/skills/ui/SkillMarketPage',()=>({SkillMarketPage:()=> <p>技能安装列表</p>}));
vi.mock('./Plugins',()=>({Plugins:()=> <p>MCP 管理</p>}));
vi.mock('./AgentProfiles',()=>({AgentProfiles:()=> <p>专业配置</p>}));
import { CapabilityHub } from './CapabilityHub';
import { closeModal, topModal } from '@/shared/overlays/controller';
it('HUB-01 three tabs preserve skill entry and open plugin and profile management', async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  const host=document.createElement('div'), root=createRoot(host);
  try {
    await act(async()=>root.render(<CapabilityHub/>));
    expect(host.textContent).toContain('技能安装列表');
    for(const [label,text] of [['插件','MCP 管理'],['智能体','专业配置'],['技能','技能安装列表']]){
      await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(b=>b.textContent===label)!.click());
      expect(host.textContent).toContain(text);
    }
  } finally {await act(async()=>root.unmount());}
});

it('HUB-UI-02 AC1 the plugin toolbar opens a connector form over the current search', async () => {
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<CapabilityHub/>));
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '插件')!.click());
    expect(host.querySelector('[aria-label="搜索插件"]')).not.toBeNull();
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '添加')!.click());
    expect(topModal()?.id).toBe('mcpConnector');
    expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe('插件');
    await act(async () => closeModal());
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '管理')!.click());
    expect(topModal()?.id).toBe('mcp');
  } finally {
    await act(async () => { if (topModal()) closeModal(); root.unmount(); });
  }
});
