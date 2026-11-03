import { useEffect, useState } from 'react';
import { Btn } from '@/shared/ui/Button';
import { Spinner } from '@/shared/ui/Controls';
import { McpManager } from '@/features/settings/ui/McpModal';
import { listMcp, protectedMcp, mcpStatusLabel, type McpServer } from '@/features/settings/runtime/mcpManager';
import { CatalogItem, CategoryBar } from './CatalogItem';
import { PluginAssignments } from './PluginAssignments';
export function Plugins({query=''}:{query?:string}) {
  const [rows,setRows]=useState<McpServer[]>([]), [loading,setLoading]=useState(true), [error,setError]=useState('');
  const [category,setCategory]=useState('全部'), [detail,setDetail]=useState<McpServer|'manage'|'add'|'assign'>(), [revision,setRevision]=useState(0);
  useEffect(()=>{let live=true;setLoading(true);setError('');void listMcp().then(data=>{if(live)setRows(data.filter(r=>!protectedMcp(r)));},e=>{if(live)setError(e instanceof Error?e.message:'读取失败');}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[revision]);
  if(detail) return <section className="hub-detail"><Btn label="返回插件" onClick={()=>{setDetail(undefined);setRevision(n=>n+1);}}/>{detail==='assign'?<PluginAssignments/>:<McpManager embedded initialServer={typeof detail==='object'?detail:undefined} initialNew={detail==='add'}/>}</section>;
  const kind=(r:McpServer)=>r.transport.type==='stdio'?'本机工具':'远程服务';
  const visible=rows.filter(r=>(category==='全部'||category===kind(r))&&r.name.toLowerCase().includes(query.toLowerCase()));
  return <><div className="hub-filter-row"><CategoryBar items={['全部','远程服务','本机工具']} value={category} onChange={setCategory}/><div className="hub-skill-actions"><Btn label="分配给助理" onClick={()=>setDetail('assign')}/><Btn label="管理" onClick={()=>setDetail('manage')}/><Btn label="添加" ic="plus" onClick={()=>setDetail('add')}/></div></div>
    <div className="hub-section-heading"><h2>我的插件</h2><span>来自已添加的 MCP 服务</span></div>
    {loading?<p role="status" className="row"><Spinner/>正在读取插件…</p>:error?<p role="alert">{error}<Btn label="重试" onClick={()=>setRevision(n=>n+1)}/></p>:<><div className="hub-grid">{visible.map(r=><CatalogItem key={r.id} name={r.name} description={`${kind(r)} · ${r.enabled?'已启用':'已停用'}`} meta={`上次测试：${mcpStatusLabel(r.last_test_status)}`} icon={r.transport.type==='stdio'?'terminal':'globe'} action="配置" onClick={()=>setDetail(r)}/>)}</div>{!visible.length&&<p className="hub-empty">{rows.length?'没有匹配的插件，试试其他关键词或分类。':'还没有添加插件。添加 MCP 服务后，它会出现在这里。'}</p>}</>}
  </>;
}
