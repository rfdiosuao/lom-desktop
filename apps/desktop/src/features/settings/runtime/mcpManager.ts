import { api } from '@/core/client';
export interface McpTransport { type:'stdio'|'http'|'sse'; command?:string; args?:string[]; env?:Record<string,string>; url?:string; headers?:Record<string,string>; }
export interface McpServer { id:string;name:string;enabled:boolean;builtin:boolean;transport:McpTransport;last_test_status:string;tools?:{name:string;description?:string}[]; }
export const listMcp = () => api<McpServer[]>('GET','/api/mcp/servers');
export const protectedMcp = (s:McpServer) => s.builtin || s.name.startsWith('lom-phone-');
export function parseTransport(json:string):McpTransport {
  const t=JSON.parse(json) as McpTransport;
  if(!t || !['stdio','http','sse'].includes(t.type)) throw new Error('transport.type 需要是 stdio、http 或 sse');
  if(t.type==='stdio') { if(!t.command?.trim() || (t.args && (!Array.isArray(t.args)||t.args.some(x=>typeof x!=='string')))) throw new Error('请填写命令和字符串参数数组'); }
  else { const url=new URL(t.url||''); if(!['http:','https:'].includes(url.protocol)||url.username||url.password) throw new Error('请输入有效 HTTP(S) URL，凭据放入 headers'); }
  for(const obj of [t.env,t.headers]) if(obj && (Array.isArray(obj)||typeof obj!=='object'||Object.values(obj).some(x=>typeof x!=='string'))) throw new Error('env / headers 必须是字符串键值对象');
  return t;
}
export async function saveMcp(name:string,json:string,existing?:McpServer) {
  if(existing && protectedMcp(existing)) throw new Error('内部服务由应用管理');
  if(existing && name.trim()!==existing.name) throw new Error('服务名称创建后不可修改，请编辑连接配置');
  if(!name.trim() || name.trim().startsWith('lom-phone-')) throw new Error('请输入非内部服务名称');
  const transport=parseTransport(json);
  return api<McpServer>(existing?'PUT':'POST',existing?`/api/mcp/servers/${encodeURIComponent(existing.id)}`:'/api/mcp/servers',{name:name.trim(),transport});
}
export async function changeMcp(row:McpServer,remove=false) {
  if(protectedMcp(row)) throw new Error('内部服务由应用管理');
  return api(remove?'DELETE':'POST',`/api/mcp/servers/${encodeURIComponent(row.id)}${remove?'':'/toggle'}`,remove?undefined:{});
}
export async function testMcp(row:McpServer) {
  const r=await api<{success:boolean;tools?:{name:string}[];error?:string;needs_auth?:boolean}>('POST','/api/mcp/test-connection',{id:row.id,name:row.name,transport:row.transport});
  if(!r.success) throw new Error(r.needs_auth?'此服务需要完成授权后连接':r.error||'MCP 连接失败');
  return `连接成功，发现 ${r.tools?.length || 0} 个工具`;
}
