import { SkillSource } from './SkillSource';
import { useEffect, useState } from 'react';
import { Btn } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { Modal } from '@/shared/ui/Overlay';
import { friendlyError } from '@/shared/lib/friendlyError';
import { SkillReadme } from './SkillReadme';
import { useStore } from '@/state/store';
import { closeModal, confirm, toast } from '@/shared/overlays/controller';
import { CATEGORIES, installMarketSkill, marketDetail, priceLabel, purchaseSkill, submitSkill, reportSkill, type SkillDetail } from '../runtime/skillMarket';
import './marketDetail.css';
/** 付费且还没拥有的技能，安装前要先用积分购买 */
const needPay=(d?:SkillDetail)=>!!d && !d.owned && (d.price ?? 0) > 0;
/** #451：扣了积分但没装好时，说清已扣、已拥有、重新安装不会再扣 */
const paidNotInstalled=(charged:number,e:unknown)=>new Error(`已扣 ${charged} 积分，技能已归你所有，但这次没有装好：${friendlyError(e)}。可以直接点「安装技能」重新安装，不会再扣积分。`);
export function MarketDetailModal({p}:{p:Record<string,unknown>}) {
  const s=useStore(), id=String(p.id);
  const [detail,setDetail]=useState<SkillDetail>(), [error,setError]=useState(''), [busy,setBusy]=useState(false), [target,setTarget]=useState('pc'), [receipt,setReceipt]=useState('');
  const [report,setReport]=useState(false), [reason,setReason]=useState('无法使用'), [note,setNote]=useState('');
  useEffect(()=>{let active=true;void marketDetail(id).then(x=>{if(active)setDetail(x);},e=>{if(active)setError(String(e.message||e));});return()=>{active=false;};},[id]);
  const run=async(fn:()=>Promise<string>)=>{setBusy(true);setError('');setReceipt('');try{setReceipt(await fn());}catch(e){setError(friendlyError(e));}finally{setBusy(false);}};
  const offline=target!=='pc' && (!s.agents[target]?.real || s.agents[target].status!=='online');
  return <Modal title={detail?.name || String(p.name || '技能详情')} desc={detail?.summary || (typeof p.summary === 'string' ? p.summary : undefined)} className="skill-market-detail"
    headExtra={<span className="skill-detail-mark" aria-hidden="true"><Icon name="sparkles"/></span>} foot={<><Btn label="举报" disabled={busy} onClick={()=>setReport(!report)}/><select className="input" aria-label="安装到" value={target} disabled={busy} onChange={e=>setTarget(e.target.value)}><option value="pc">电脑主控</option>{s.phoneOrder.filter(x=>s.agents[x]?.real).map(x=><option key={x} value={x}>{s.agents[x].name}{s.agents[x].status!=='online'?' · 离线':''}</option>)}</select><Btn label={busy?'正在处理…':'安装技能'} variant="primary" disabled={!detail||busy||offline} onClick={()=>confirm({title:`安装「${detail?.name}」？`,desc:`${needPay(detail)?`安装需要 ${detail?.price} 积分（当前 ${s.points?.total ?? '—'} 点），买过之后可以随时重新安装。`:''}技能可能包含可执行脚本。确认信任作者后安装；安装不会自动执行。电脑同名个人技能可能被更新。`,okText:needPay(detail)?`支付 ${detail?.price} 积分并安装`:'安装',onOk:()=>void run(async()=>{let charged=0;if(needPay(detail)){charged=await purchaseSkill(id);setDetail(d=>d&&{...d,owned:true});if(charged)toast(`已扣 ${charged} 积分`,'wallet');}try{return await installMarketSkill(id,target,detail?.sha256);}catch(e){throw charged>0?paidNotInstalled(charged,e):e;}})})}/></>}>
    {error&&<p role="alert">{error}</p>}{receipt&&<p role="status">{receipt}</p>}
    {detail&&<><div className="skill-detail-meta"><span>{detail.category} · v{detail.version} · {priceLabel(detail)}</span><SkillSource source={detail.source}/></div><div className="skill-detail-readme"><SkillReadme text={detail.readme || '没有技能说明'}/></div><details><summary>{detail.files.length} 个文件</summary>{detail.files.map(f=><p key={f.path}>{f.path} · {f.size} 字节</p>)}</details></>}
    {offline&&<p className="muted">手机离线，连接后再安装。</p>}
    {report&&<div className="integration-panel"><select className="input" aria-label="举报原因" value={reason} onChange={e=>setReason(e.target.value)}>{['危险操作','侵权','违规内容','无法使用','其他'].map(x=><option key={x}>{x}</option>)}</select><textarea className="textarea" aria-label="举报说明" value={note} onChange={e=>setNote(e.target.value)}/><Btn label="提交举报" disabled={busy} onClick={()=>void run(async()=>{await reportSkill(id,reason,note);setReport(false);return '举报已提交';})}/></div>}
  </Modal>;
}
export function MarketUploadModal({p}:{p:Record<string,unknown>}) {
  const [name,setName]=useState(String(p.name||'')), [summary,setSummary]=useState(''), [category,setCategory]=useState(String(p.category||'其他'));
  const [file,setFile]=useState<File>(), [busy,setBusy]=useState(false), [error,setError]=useState('');
  const submit=async()=>{if(!file)return;setBusy(true);setError('');try{const r=await submitSkill(file,name,summary,category,p.id?String(p.id):undefined);toast(`v${r.version} 已提交审核，尚未上架`,'check');closeModal();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  return <Modal title={p.id?'上传技能新版本':'上传技能'} desc="ZIP 不超过 10 MB，包含 SKILL.md。提交后需审核，公开上架以审核结果为准。" size="lg" foot={<Btn label={busy?'提交中…':'提交审核'} variant="primary" disabled={busy||!file||!name.trim()||!summary.trim()} onClick={()=>void submit()}/>}>
    <div className="integration-panel"><label>技能名称<input className="input" maxLength={40} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label>
      <label>一句话介绍<textarea className="textarea" maxLength={120} value={summary} disabled={busy} onChange={e=>setSummary(e.target.value)}/></label>
      <label>分类<select className="input" value={category} disabled={busy} onChange={e=>setCategory(e.target.value)}>{CATEGORIES.map(x=><option key={x}>{x}</option>)}</select></label>
      <label>技能包<input type="file" accept=".zip" disabled={busy} onChange={e=>setFile(e.target.files?.[0])}/></label>
      {error&&<p role="alert">{error}</p>}</div>
  </Modal>;
}
