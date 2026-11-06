import { t } from '@/shared/i18n/index';
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
      <label>{t('传输类型')}<select className="input" value={transport.type} disabled={disabled} onChange={e=>onChange(JSON.stringify(e.target.value==='stdio'?{type:'stdio',command:'',args:[]}:{type:e.target.value,url:''},null,2))}><option value="http">HTTP</option><option value="sse">SSE</option><option value="stdio">{t('本机程序（stdio）')}</option></select></label>
      {transport.type==='stdio' ? <><label>{t('启动命令')}<input className="input" value={transport.command||''} disabled={disabled} onChange={e=>field({command:e.target.value})}/></label><label>{t('启动参数（每行一项）')}<textarea className="textarea" value={(transport.args||[]).join('\n')} disabled={disabled} onChange={e=>field({args:e.target.value.split('\n').filter(Boolean)})}/></label></> : <label>{t('服务地址')}<input className="input" placeholder={t('https://服务地址/mcp')} value={transport.url||''} disabled={disabled} onChange={e=>field({url:e.target.value})}/></label>}
    </>}
    <div className="connector-advanced">
      <p className="muted">{t('请求头和环境变量可在高级配置中填写。切换传输类型会清空当前参数。')}</p>
      <Btn label={advanced?'收起高级配置':'高级配置'} size="sm" disabled={disabled} onClick={()=>setAdvanced(!advanced)}/>
    </div>
    {(advanced || !transport) && <label>{t('连接配置')}<textarea aria-label={t('MCP 连接配置')} className="textarea textarea--mono" value={value} onChange={e=>onChange(e.target.value)} disabled={disabled}/></label>}
  </>;
}
