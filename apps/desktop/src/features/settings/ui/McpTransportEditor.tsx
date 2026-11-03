import { useState } from 'react';
import { Btn } from '@/shared/ui/Button';
import type { McpTransport } from '../runtime/mcpManager';
export function McpTransportEditor({ value, onChange, disabled }: { value:string; onChange:(v:string)=>void; disabled:boolean }) {
  const [advanced,setAdvanced] = useState(false);
  let transport: McpTransport | undefined;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && ['stdio','http','sse'].includes(parsed.type)
      && (parsed.args === undefined || (Array.isArray(parsed.args) && parsed.args.every((v: unknown) => typeof v === 'string')))
      && ['url','command'].every(k => parsed[k] === undefined || typeof parsed[k] === 'string')) transport = parsed;
  } catch { /* Invalid advanced JSON is retained for correction; save validates it. */ }
  const field = (patch: Partial<McpTransport>) => onChange(JSON.stringify({...transport,...patch},null,2));
  return <>
    {!advanced && transport && <>
      <label>连接方式<select className="input" value={transport.type} disabled={disabled} onChange={e=>onChange(JSON.stringify(e.target.value==='stdio'?{type:'stdio',command:'',args:[]}:{type:e.target.value,url:''},null,2))}><option value="http">远程服务</option><option value="sse">远程服务（SSE）</option><option value="stdio">本机程序</option></select></label>
      {transport.type==='stdio' ? <><label>启动命令<input className="input" value={transport.command||''} disabled={disabled} onChange={e=>field({command:e.target.value})}/></label><label>启动参数（每行一项）<textarea className="textarea" value={(transport.args||[]).join('\n')} disabled={disabled} onChange={e=>field({args:e.target.value.split('\n').filter(Boolean)})}/></label></> : <label>服务地址<input className="input" placeholder="https://服务地址/mcp" value={transport.url||''} disabled={disabled} onChange={e=>field({url:e.target.value})}/></label>}
      <p className="muted">需要请求头、环境变量或已有配置时，展开高级配置。切换连接方式会清空当前连接参数。</p>
    </>}
    <Btn label={advanced?'收起高级配置':'高级配置'} disabled={disabled} onClick={()=>setAdvanced(!advanced)}/>
    {(advanced || !transport) && <label>连接配置<textarea aria-label="MCP 连接配置" className="textarea textarea--mono" value={value} onChange={e=>onChange(e.target.value)} disabled={disabled}/></label>}
  </>;
}
