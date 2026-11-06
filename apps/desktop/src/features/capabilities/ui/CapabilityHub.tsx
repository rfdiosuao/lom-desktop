import { useState } from 'react';
import { Icon } from '@/shared/ui/Icon';
import { Btn } from '@/shared/ui/Button';
import { openModal } from '@/shared/overlays/controller';
import { useStore } from '@/state/store';
import { SkillMarketPage } from '@/features/skills/ui/SkillMarketPage';
import { Plugins } from './Plugins';
import { AgentProfiles } from './AgentProfiles';
import './hub.css';
export function CapabilityHub() {
  const [tab,setTab]=useState('skills'), [query,setQuery]=useState('');
  const s=useStore(), tabs=[{id:'plugins',label:'插件'},{id:'skills',label:'技能'},{id:'agents',label:'智能体'}];
  const label=tabs.find(t=>t.id===tab)!.label;
  return <section className="capability-hub" aria-label="插件 · 技能 · 智能体">
    <header className="hub-header">
      <div className="hub-tabs" role="tablist" aria-label="能力类型">
        {tabs.map(t => <button type="button" key={t.id} role="tab" aria-selected={tab === t.id}
          onClick={() => { setTab(t.id); setQuery(''); }}>{t.label}</button>)}
      </div>
      <div className="hub-toolbar">
        <label className="hub-search"><Icon name="search"/><input aria-label={`搜索${label}`}
          placeholder={`搜索${label}`} value={query} onChange={e => setQuery(e.target.value)}/></label>
        {tab === 'plugins' && <>
          <Btn size="sm" label="管理" onClick={() => openModal('mcp')}/>
          <Btn size="sm" label="添加" ic="plus" onClick={() => openModal('mcpConnector')}/>
        </>}
      </div>
    </header>
    <div className="hub-body" key={`${s.account?.id||'local'}:${s.cloud}:${tab}`}>
      {tab==='skills'?<SkillMarketPage query={query}/>:tab==='plugins'?<Plugins query={query}/>:<AgentProfiles query={query}/>}
    </div></section>;
}
