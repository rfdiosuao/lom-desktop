import { useState } from 'react';
import { Btn } from '@/shared/ui/Button';
import { PROFILE_TEMPLATES, type Profile } from '../runtime/profiles';
import { ProfileEditor } from './ProfileEditor';
import { CatalogItem, CategoryBar } from './CatalogItem';
const categories = ['全部', ...new Set(PROFILE_TEMPLATES.map(p => p.category))];
export function AgentProfiles({ query = '' }: { query?: string }) {
  const [selected,setSelected] = useState<Profile>(), [category,setCategory] = useState('全部');
  if(selected) return <section className="hub-detail"><Btn label="返回智能体" ic="back" onClick={()=>setSelected(undefined)}/><ProfileEditor initial={selected}/></section>;
  const rows = PROFILE_TEMPLATES.filter(p => (category === '全部' || p.category === category) && `${p.name} ${p.description} ${p.tags.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <><div className="hub-filter-row"><CategoryBar items={categories} value={category} onChange={setCategory}/><Btn label="创建智能体" ic="plus" onClick={()=>setSelected({name:'',rules:''})}/></div>
    <div className="hub-section-heading"><h2>专业智能体</h2><span>为你的 Agent 配上专业分工</span></div>
    <div className="hub-grid">{rows.map((p,i)=><CatalogItem key={p.name} name={p.name} description={p.description} meta={p.tags.map(tag=><span className="hub-tag" key={tag}>{tag}</span>)} avatar={p.avatar} icon={p.icon} tone={i} action="应用" onClick={()=>setSelected(p)}/>)}</div>
    {!rows.length&&<p className="hub-empty">没有匹配的智能体，试试其他关键词或分类。</p>}
  </>;
}
