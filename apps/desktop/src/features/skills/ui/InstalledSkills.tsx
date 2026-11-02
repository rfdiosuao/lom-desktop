import { useEffect, useRef, useState } from 'react';
import { Btn } from '@/shared/ui/Button';
import { Markdown } from '@/shared/ui/Markdown';
import { confirm } from '@/shared/overlays/controller';
import { useStore } from '@/state/store';
import { installedSkills, installedDetail, removeSkill, togglePhoneSkill, type InstalledSkill } from '../runtime/skillMarket';
export function InstalledSkills({device: fixed}:{device?:string}) {
  const s=useStore(), [selected,setSelected]=useState('pc');
  const device=fixed || selected;
  const [rows,setRows]=useState<InstalledSkill[]>([]), [error,setError]=useState(''), [busy,setBusy]=useState(false), [revision,setRevision]=useState(0);
  const [detail,setDetail]=useState('');
  const scope=useRef(''); scope.current=`${s.account?.id}:${device}:${revision}`;
  const readDetail=async(row:InstalledSkill)=>{const key=scope.current;try{const text=await installedDetail(device,row);if(scope.current===key)setDetail(text);}catch(e){if(scope.current===key)setError(e instanceof Error?e.message:String(e));}};
  useEffect(()=>()=>{scope.current='unmounted';},[]);
  useEffect(()=>{
    let active=true; setRows([]);setDetail('');setError('');setBusy(true);
    void installedSkills(device).then(r=>{if(active)setRows(r);},e=>{if(active)setError(String(e.message||e));}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[device,revision,s.account?.id]);
  const action=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try {await fn();setRevision(n=>n+1);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  return <section className="integration-panel">
    <p className="muted">这里显示所选设备的实际安装。电脑技能安装后请新建聊天使用；已有聊天的技能列表不会自动更新。</p>
    <div className="toolbar">{!fixed && <select className="input" aria-label="技能安装位置" value={device} onChange={e=>setSelected(e.target.value)}><option value="pc">电脑主控</option>{s.phoneOrder.filter(id=>s.agents[id]?.real).map(id=><option key={id} value={id}>{s.agents[id].name}</option>)}</select>}
      <Btn label="刷新已安装" disabled={busy} onClick={()=>setRevision(n=>n+1)}/></div>
    {error && <p role="alert">{error}</p>}{busy && <p role="status">正在处理…</p>}
    {!busy&&!error&&!rows.length&&<p className="muted">没有可显示的已安装技能。</p>}
    <div className="list">{rows.map(row=><div className="card" key={row.id}><div className="row"><h3 className="grow">{row.name}</h3><span>{row.version}{row.enabled!==undefined && (row.enabled?' · 已启用':' · 已停用')}</span></div><p>{row.description}</p>
      <div className="row"><Btn label="详情" disabled={busy} onClick={()=>void readDetail(row)}/>
      {device!=='pc'&&<Btn label={row.enabled?'停用':'启用'} disabled={busy} onClick={()=>void action(()=>togglePhoneSkill(device,row.id,!row.enabled))}/>}
      {row.removable&&<Btn label="卸载" disabled={busy} variant="danger-ghost" onClick={()=>confirm({title:`卸载「${row.name}」？`,desc:'会删除该设备上的技能文件，已执行的任务不受影响。',danger:true,okText:'卸载',onOk:()=>void action(()=>removeSkill(device,row.id))})}/>}</div></div>)}</div>
    {detail&&<div className="card msg__text"><Btn label="收起详情" onClick={()=>setDetail('')}/><Markdown text={detail}/></div>}
  </section>;
}
