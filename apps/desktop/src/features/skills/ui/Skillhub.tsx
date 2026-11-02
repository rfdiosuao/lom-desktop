import { SkillSource } from './SkillSource';
import { ReviewDraft } from './ReviewDraft';
import { UploadMenu } from './UploadMenu';
import { useEffect, useState } from 'react';
import { Badge, Spinner } from '@/shared/ui/Controls';
import { Btn } from '@/shared/ui/Button';
import { Tabs } from '@/shared/ui/Controls';
import { Empty, PageHead } from '@/shared/ui/Layout';
import { openModal } from '@/shared/overlays/controller';
import { useStore } from '@/state/store';
import { listMarket, mineSkills, priceLabel, CATEGORIES, type MarketSkill, type MineSkill } from '../runtime/skillMarket';
import { InstalledSkills } from './InstalledSkills';
import { Page } from '@/shared/ui/Page';
export function Skillhub() {
  const s=useStore();
  return <SkillMarket key={s.account?.id || 'signed-out'} />;
}
function SkillMarket() {
  const [tab,setTab]=useState('discover'), [query,setQuery]=useState(''), [category,setCategory]=useState('');
  const [rows,setRows]=useState<MarketSkill[]>([]), [mine,setMine]=useState<MineSkill[]>([]);
  const [error,setError]=useState(''), [loading,setLoading]=useState(true), [refresh,setRefresh]=useState(0);
  const s=useStore();
  useEffect(()=>{
    if(tab==='installed') return;
    let active=true; setLoading(true); setError('');
    const timer=setTimeout(()=>{ void (tab==='mine' ? mineSkills() : listMarket(query,category)).then(data=>{
      if(active) { if(tab==='mine') setMine(data as MineSkill[]); else setRows(data as MarketSkill[]); }
    },e=>{if(active)setError(String(e.message||e));}).finally(()=>{if(active)setLoading(false);}); },250);
    return()=>{active=false;clearTimeout(timer);};
  },[tab,query,category,refresh,s.modals.length]);
  return <Page><PageHead title="skillhub" desc="发现、安装和管理真实技能。技能安装后不会自动运行。"
    actions={<><Btn label="刷新" onClick={()=>setRefresh(n=>n+1)} /><UploadMenu /></>} />
    <Tabs value={tab} onChange={setTab} items={[{value:'discover',label:'发现'},{value:'installed',label:'已安装'},{value:'mine',label:'我的上传'}]}/>
    {tab==='discover' && <div className="toolbar skill-market-toolbar"><input className="input" aria-label="搜索技能" placeholder="搜索技能" value={query} onChange={e=>setQuery(e.target.value)}/>
      <select className="input" aria-label="技能分类" value={category} onChange={e=>setCategory(e.target.value)}><option value="">全部分类</option>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></div>}
    {tab!=='installed' && (loading ? <p role="status" className="row" aria-live="polite"><Spinner />正在加载技能…</p> : error ? <p role="alert">{error}</p> : tab==='discover' ?
      rows.length ? <div className="grid-cards">{rows.map(k=><div className="card skill-card" key={k.id}><h3>{k.name}</h3><p>{k.summary}</p><SkillSource source={k.source}/><p className="muted">{k.author || '作者'} · {k.category} · v{k.version} · {k.downloads} 次下载</p><div className="row" style={{justifyContent:'space-between'}}><Badge text={priceLabel(k)} tone={k.owned ? 'ok' : 'warn'}/><Btn label="查看与安装" onClick={()=>openModal('marketDetail',{id:k.id,sha256:k.sha256})}/></div></div>)}</div>
      : <Empty title="暂无已上架技能" desc="可以上传自己的技能，审核通过后会在这里展示。" ic="grid" />
      : mine.length ? <div className="list">{mine.map(k=><div className="card" key={k.id}><h3>{k.name}</h3><p>{k.removed ? `已下架：${k.removed_reason}` : k.category}</p>{k.versions.map(v=><div key={v.version}><p>v{v.version} · {v.label}{v.reject_reason && `：${v.reject_reason}`}</p>{['pending','rejected'].includes(v.status)&&<details><summary>查看与修改审核草稿</summary><ReviewDraft id={v.id}/></details>}</div>)}<Btn label="上传新版本" onClick={()=>openModal('marketUpload',{id:k.id,name:k.name,category:k.category})}/></div>)}</div> : <Empty title="还没有上传技能" ic="upload" />)}
    {tab==='installed' && <InstalledSkills />}
  </Page>;
}
