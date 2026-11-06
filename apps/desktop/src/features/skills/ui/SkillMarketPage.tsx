import { SkillSource } from './SkillSource';
import { ReviewDraft } from './ReviewDraft';
import { UploadMenu } from './UploadMenu';
import { useEffect, useState } from 'react';
import { Btn } from '@/shared/ui/Button';
import { Tabs } from '@/shared/ui/Controls';
import { Empty } from '@/shared/ui/Layout';
import { openModal } from '@/shared/overlays/controller';
import { useStore } from '@/state/store';
import { listMarket, mineSkills, priceLabel, CATEGORIES, type MarketSkill, type MineSkill } from '../runtime/skillMarket';
import { readSkillCatalog, refreshSkillCatalog } from '../runtime/skillCatalog';
import { InstalledSkills } from './InstalledSkills';
import { CatalogItem, CategoryBar } from '@/features/capabilities/ui/CatalogItem';
export function SkillMarketPage({ query = '' }: { query?: string }) {
  const s=useStore();
  return <SkillMarket key={s.account?.id || 'signed-out'} query={query} />;
}
function SkillMarket({ query }: { query: string }) {
  const s = useStore();
  const account = s.cloud === 'signed-in' ? s.account?.id : undefined;
  const [tab,setTab]=useState('discover'), [category,setCategory]=useState('');
  const [rows, setRows] = useState(() => readSkillCatalog(account));
  const [mine, setMine] = useState<MineSkill[]>();
  const [mineError, setMineError] = useState(false);
  const [remoteMatches, setRemoteMatches] = useState<{ key: string; rows: MarketSkill[] }>();
  const skillModalOpen = s.modals.some(modal => modal.id === 'marketDetail' || modal.id === 'marketUpload');
  const search = query.trim().toLowerCase();
  const searchKey = JSON.stringify([search, category]);
  useEffect(() => {
    if (!account || skillModalOpen) return;
    let active = true;
    void refreshSkillCatalog(account).then(data => { if (active) { setRows(data); setRemoteMatches(undefined); } }).catch(() => {});
    return () => { active = false; };
  }, [account, skillModalOpen]);
  useEffect(() => {
    if (tab !== 'mine' || skillModalOpen) return;
    let active = true;
    setMineError(false);
    void mineSkills().then(data => { if (active) setMine(data); }).catch(() => { if (active) setMineError(true); });
    return () => { active = false; };
  }, [tab, skillModalOpen]);
  useEffect(() => {
    if (!account || tab !== 'discover' || rows.length < 200 || (!search && !category)) return;
    let active = true;
    const timer = setTimeout(() => {
      void listMarket(search, category).then(data => {
        if (active) setRemoteMatches({ key: searchKey, rows: data });
      }).catch(() => {});
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [account, tab, rows, search, category, searchKey]);
  const visible = remoteMatches?.key === searchKey ? remoteMatches.rows : rows.filter(row =>
    (!category || row.category === category) && `${row.name} ${row.summary}`.toLowerCase().includes(search));
  return <><div className="hub-filter-row"><Tabs value={tab} onChange={setTab} items={[{value:'discover',label:'发现'},{value:'installed',label:'已安装'},{value:'mine',label:'我的上传'}]}/><div className="hub-skill-actions"><UploadMenu /></div></div>
    {tab==='discover' && <CategoryBar items={['全部',...CATEGORIES]} value={category || '全部'} onChange={v=>setCategory(v==='全部'?'':v)}/>}
    <div className="hub-section-heading"><h2>{tab==='discover'?'发现技能':tab==='installed'?'已安装技能':'我的上传'}</h2><span>安装后不会自动运行</span></div>
    {tab==='discover' ? (
      visible.length ? <div className="hub-grid">{visible.map((k,i)=><CatalogItem key={k.id} name={k.name} description={k.summary} icon="sparkles" tone={i} meta={<><span>{k.category} · {priceLabel(k)}</span><SkillSource source={k.source}/></>} action="查看与安装" onClick={()=>openModal('marketDetail',{id:k.id,name:k.name,summary:k.summary})}/>)}</div>
      : <Empty title={search || category ? "没有匹配的技能" : "暂无已上架技能"} ic="grid" />) : null}
    {tab==='mine' && (mineError ? <p role="alert">暂时无法读取上传记录。</p> : mine?.length ? <div className="list">{mine.filter(k=>k.name.toLowerCase().includes(query.toLowerCase())).map(k=><div className="card" key={k.id}><h3>{k.name}</h3><p>{k.removed ? `已下架：${k.removed_reason}` : k.category}</p>{k.versions.map(v=><div key={v.version}><p>v{v.version} · {v.label}{v.reject_reason && `：${v.reject_reason}`}</p>{['pending','rejected'].includes(v.status)&&<details><summary>查看与修改审核草稿</summary><ReviewDraft id={v.id}/></details>}</div>)}<Btn label="上传新版本" onClick={()=>openModal('marketUpload',{id:k.id,name:k.name,category:k.category})}/></div>)}</div> : mine ? <Empty title="还没有上传技能" ic="upload" /> : null)}
    {tab==='installed' && <InstalledSkills query={query} />}
  </>;
}
