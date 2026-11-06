import { t, tf } from '@/shared/i18n/index';
import { McpTransportEditor } from './McpTransportEditor';
import { Spinner } from '@/shared/ui/Controls';
import { useEffect, useRef, useState } from 'react';
import { authorizeMcp, clearMcpOAuth, oauthEligible, oauthClearable } from '../runtime/mcpOAuth';
import { authRevision, onAuthChange } from '@/features/account/runtime/authScope';
import { Modal } from '@/shared/ui/Overlay';
import { Btn } from '@/shared/ui/Button';
import { confirm } from '@/shared/overlays/controller';
import { McpConfigError } from '../runtime/mcpConfig';
import { listMcp, saveMcp, changeMcp, connectMcp, enableDiscoveredMcp, hostedMcp, isHostedMcp, protectedMcp, mcpStatusLabel, type McpServer } from '../runtime/mcpManager';
const blank=JSON.stringify({type:'http',url:'https://example.com/mcp'},null,2);
export function McpManager({ embedded = false, initialServer, initialNew = false }: { embedded?: boolean; initialServer?: McpServer; initialNew?: boolean }) {
  const [rows,setRows]=useState<McpServer[]>([]), [error,setError]=useState(''), [detail,setDetail]=useState(''), [notice,setNotice]=useState(''), [busy,setBusy]=useState(false), [loading,setLoading]=useState(true);
  const [editing,setEditing]=useState<McpServer|null|undefined>(initialNew ? null : undefined), [name,setName]=useState(''), [transport,setTransport]=useState(blank);
  const alive=useRef(true), authorization=useRef<AbortController|null>(null);
  const [authorizing,setAuthorizing]=useState(false);
  const load=async()=>{const current=authRevision();const rows=await listMcp();if(alive.current&&current())setRows(rows);};
  useEffect(()=>{alive.current=true;const unsubscribe=onAuthChange(()=>{authorization.current?.abort();setRows([]);setEditing(undefined);setNotice('');setError(t('账号已变化，请刷新服务列表'));});return()=>{alive.current=false;authorization.current?.abort();unsubscribe();};},[]);
  useEffect(()=>{let active=true;const current=authRevision();void listMcp().then(x=>{if(active&&current())setRows(x);},e=>{if(active&&current())setError(String(e.message||e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
  const run=async(fn:()=>Promise<string>)=>{const current=authRevision();setBusy(true);setError('');setDetail('');setNotice('');try{const message=await fn();if(alive.current&&current()){setNotice(message);await load();}}catch(e){if(alive.current&&current()){setError(e instanceof Error?e.message:String(e));setDetail(e instanceof McpConfigError?e.detail||'':'');}}finally{if(alive.current)setBusy(false);}};
  const authorize=(r:McpServer)=>{const controller=new AbortController();authorization.current=controller;setAuthorizing(true);const current=authRevision();void run(async()=>{await authorizeMcp(r,controller.signal);return enableDiscoveredMcp(r,()=>current()&&!controller.signal.aborted);}).finally(()=>{if(authorization.current===controller)authorization.current=null;if(alive.current)setAuthorizing(false);});};
  const edit=(r?:McpServer)=>{setEditing(r||null);setName(r?.name||'');setTransport(r?JSON.stringify(r.transport,null,2):blank);};
  const actions = <><Btn label="刷新" disabled={busy} onClick={()=>void run(async()=>{await load();return t('列表已刷新');})}/><Btn label="添加服务" disabled={busy} variant="primary" onClick={()=>edit()}/></>;
  const external = rows.filter(r => !protectedMcp(r));
  const canAddHosted = !!hostedMcp.url && !initialServer && !loading && !error && !external.some(isHostedMcp);
  const addHosted = () => {
    setEditing(null);
    setName(hostedMcp.name);
    setTransport(JSON.stringify({ type: 'http', url: hostedMcp.url }, null, 2));
  };
  const content = <>
    {canAddHosted && editing === undefined && <div className="integration-panel">
      <h3>{t('Activepieces 连接器')}</h3>
      <p className="muted">{t('地址：')}{new URL(hostedMcp.url).hostname}{t('。这是自行配置的 Activepieces 服务，不是客户端内置功能。授权时，你选择的服务账号权限会交给这台服务，请在浏览器里核对后再允许。')}</p>
      <Btn label="添加托管连接器" disabled={busy} onClick={addHosted}/>
    </div>}
    {error&&<p role="alert">{error}</p>}{error&&detail&&<p className="muted">{t('详情：')}{detail}</p>}{notice&&<p role="status">{notice}</p>}{busy&&<p role="status">{authorizing?t('请在浏览器登录并核对服务请求的权限。授权后将自动验证连接。'):t('正在处理…')}</p>}{authorizing&&<Btn label="取消授权" onClick={()=>authorization.current?.abort()}/>}
    {editing!==undefined&&<div className="integration-panel"><label>{t('名称')}<input className="input" value={name} onChange={e=>setName(e.target.value)} disabled={busy||!!editing}/></label><McpTransportEditor key={editing?.id || "new"} value={transport} onChange={setTransport} disabled={busy} /><p className="muted">支持 HTTP、SSE 与 stdio。stdio 使用 command、args、env；网络服务使用 url、headers。配置不会写入浏览器本地缓存。</p><div className="row"><Btn label="取消编辑" disabled={busy} onClick={()=>{setEditing(undefined);setTransport(blank);}}/><Btn label="保存" disabled={busy} onClick={()=>void run(async()=>{await saveMcp(name,transport,editing||undefined);setEditing(undefined);setTransport(blank);return t('服务已保存');})}/></div></div>}
    {loading && <p role="status"><Spinner />{t('正在读取工具连接…')}</p>}{!loading && !error && !external.length && <p>{t('还没有 MCP 服务，点击「添加服务」连接工具。')}</p>}
    <div className="list">{external.filter(r=>!initialServer || r.id===initialServer.id).map(r=><div className="card" key={r.id}><h3>{r.name}</h3><p>{t(r.enabled?'已启用':'已停用')} · {t(mcpStatusLabel(r.last_test_status))}</p>
      <div className="row"><Btn label="编辑" disabled={busy} onClick={()=>edit(r)}/><>{oauthEligible(r)&&<Btn label="授权连接" disabled={busy} onClick={()=>authorize(r)}/>} {oauthClearable(r)&&<Btn label="清除本机授权" disabled={busy} onClick={()=>confirm({title:tf('清除「{name}」的本机授权？',{name:r.name}),desc:t('只清除这台电脑上保存的凭据，之后调用这个服务需要重新授权；服务端的授权记录不会被撤销。'),okText:t('清除'),danger:true,onOk:()=>void run(()=>clearMcpOAuth(r))})}/>}</><Btn label="验证并启用" disabled={busy} onClick={()=>void run(()=>connectMcp(r))}/><Btn label={r.enabled?'停用':'启用'} disabled={busy} onClick={()=>void run(async()=>{await changeMcp(r);return t('启停状态已更新');})}/><Btn label="删除" variant="danger-ghost" disabled={busy} onClick={()=>confirm({title:`删除「${r.name}」？`,okText:'删除',danger:true,onOk:()=>void run(async()=>{await changeMcp(r,true);return t('服务已删除');})})}/></div></div>)}</div>
  </>;
  return embedded ? <section aria-label={t('MCP 服务管理')}><div className="row">{actions}</div>{content}</section> : <Modal title="MCP 服务管理" size="lg" desc="配置外部工具服务；变更后请新建任务使用。内部手机服务由应用管理。" foot={actions}>{content}</Modal>;
}

export const McpModal = () => <McpManager />;
