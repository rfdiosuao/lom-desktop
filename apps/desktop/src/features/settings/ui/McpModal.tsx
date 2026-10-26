import { useEffect, useState } from 'react';
import { Modal } from '@/shared/ui/Overlay';
import { Btn } from '@/shared/ui/Button';
import { confirm } from '@/shared/overlays/controller';
import { listMcp, saveMcp, changeMcp, testMcp, protectedMcp, type McpServer } from '../runtime/mcpManager';
const blank=JSON.stringify({type:'http',url:'https://example.com/mcp'},null,2);
export function McpModal() {
  const [rows,setRows]=useState<McpServer[]>([]), [error,setError]=useState(''), [notice,setNotice]=useState(''), [busy,setBusy]=useState(false);
  const [editing,setEditing]=useState<McpServer|null|undefined>(), [name,setName]=useState(''), [transport,setTransport]=useState(blank);
  const load=()=>listMcp().then(setRows);
  useEffect(()=>{let active=true;void listMcp().then(x=>{if(active)setRows(x);},e=>{if(active)setError(String(e.message||e));});return()=>{active=false;};},[]);
  const run=async(fn:()=>Promise<string>)=>{setBusy(true);setError('');setNotice('');try{setNotice(await fn());await load();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  const edit=(r?:McpServer)=>{setEditing(r||null);setName(r?.name||'');setTransport(r?JSON.stringify(r.transport,null,2):blank);};
  return <Modal title="MCP 服务管理" size="lg" desc="配置外部工具服务；变更后请新建任务使用。内部手机服务由应用管理。" foot={<><Btn label="刷新" disabled={busy} onClick={()=>void run(async()=>{await load();return '列表已刷新';})}/><Btn label="添加服务" disabled={busy} variant="primary" onClick={()=>edit()}/></>}>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{busy&&<p>正在处理…</p>}
    {editing!==undefined&&<div className="integration-panel"><label>名称<input className="input" value={name} onChange={e=>setName(e.target.value)} disabled={busy||!!editing}/></label><label>连接配置（JSON）<textarea className="textarea textarea--mono" value={transport} onChange={e=>setTransport(e.target.value)} disabled={busy}/></label><p className="muted">支持 HTTP、SSE 与 stdio。stdio 使用 command、args、env；网络服务使用 url、headers。配置不会写入浏览器本地缓存。</p><div className="row"><Btn label="取消编辑" disabled={busy} onClick={()=>{setEditing(undefined);setTransport(blank);}}/><Btn label="保存" disabled={busy} onClick={()=>void run(async()=>{await saveMcp(name,transport,editing||undefined);setEditing(undefined);setTransport(blank);return '服务已保存';})}/></div></div>}
    <div className="list">{rows.map(r=><div className="card" key={r.id}><h3>{r.name}{protectedMcp(r)?' · 内部服务':''}</h3><p>{r.enabled?'已启用':'已停用'} · 上次测试：{r.last_test_status || '尚未测试'} · {r.tools?.length || 0} 个工具</p>
      {!protectedMcp(r)&&<div className="row"><Btn label="编辑" disabled={busy} onClick={()=>edit(r)}/><Btn label="测试连接" disabled={busy} onClick={()=>void run(()=>testMcp(r))}/><Btn label={r.enabled?'停用':'启用'} disabled={busy} onClick={()=>void run(async()=>{await changeMcp(r);return '启停状态已更新';})}/><Btn label="删除" variant="danger-ghost" disabled={busy} onClick={()=>confirm({title:`删除「${r.name}」？`,okText:'删除',danger:true,onOk:()=>void run(async()=>{await changeMcp(r,true);return '服务已删除';})})}/></div>}</div>)}</div>
  </Modal>;
}
