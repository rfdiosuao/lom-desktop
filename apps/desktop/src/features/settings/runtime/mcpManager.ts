import { api, type RequestOptions } from '@/core/client';
import { parseTransport } from './mcpConfig';
import { authRevision } from '@/features/account/runtime/authScope';
export interface McpTransport { type:'stdio'|'http'|'sse'; command?:string; args?:string[]; env?:Record<string,string>; url?:string; headers?:Record<string,string>; }
export interface McpServer { id:string;name:string;enabled:boolean;builtin:boolean;transport:McpTransport;last_test_status:string;tools?:{name:string;description?:string}[]; }
const statusLabels: Record<string, string> = { connected: '连接成功', disconnected: '未连接', error: '连接失败', testing: '测试中' };
export const mcpStatusLabel = (status?: string) => statusLabels[status || ''] || '尚未测试';
export const listMcp = () => api<McpServer[]>('GET','/api/mcp/servers',undefined,{timeoutMs:15000});
export const protectedMcp = (s:McpServer) => s.builtin || s.name.startsWith('lom-phone-');
/** Optional self-hosted connector service; community builds have no default host. */
function configuredConnectorUrl() {
  try {
    const url = new URL((import.meta.env.VITE_LOM_CONNECTOR_URL || '').trim());
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href.replace(/\/+$/, '') : '';
  } catch { return ''; }
}
export const hostedMcp = { name: 'Activepieces', url: configuredConnectorUrl() };
export const isHostedMcp = (row: McpServer) =>
  !!hostedMcp.url && row.transport.type === 'http' && row.transport.url?.replace(/\/+$/, '') === hostedMcp.url;
export { parseTransport };
export async function saveMcp(name:string,json:string,existing?:McpServer) {
  if(existing && protectedMcp(existing)) throw new Error('内部服务由应用管理');
  if(existing && name.trim()!==existing.name) throw new Error('服务名称创建后不可修改，请编辑连接配置');
  if(!name.trim() || name.trim().startsWith('lom-phone-')) throw new Error('请输入非内部服务名称');
  const transport=parseTransport(json);
  return api<McpServer>(existing?'PUT':'POST',existing?`/api/mcp/servers/${encodeURIComponent(existing.id)}`:'/api/mcp/servers',{name:name.trim(),transport},{timeoutMs:15000});
}
export async function changeMcp(row:McpServer,remove=false) {
  if(protectedMcp(row)) throw new Error('内部服务由应用管理');
  return api(remove?'DELETE':'POST',`/api/mcp/servers/${encodeURIComponent(row.id)}${remove?'':'/toggle'}`,remove?undefined:{});
}
export async function testMcp(row:McpServer, options: RequestOptions = {}) {
  const r=await api<{success:boolean;tools?:{name:string}[];error?:string;needs_auth?:boolean}>('POST','/api/mcp/test-connection',{id:row.id,name:row.name,transport:row.transport},{timeoutMs:30000,...options});
  if(!r || r.success !== true) throw new Error(r?.needs_auth?'此服务需要完成授权后连接':r?.error||'MCP 连接失败');
  if(!Array.isArray(r.tools) || r.tools.some(t=>!t || typeof t.name !== 'string' || !t.name.trim())) throw new Error('核心未返回有效工具列表，连接结果未确认');
  const names=r.tools.slice(0,10).map(t=>t.name.slice(0,120)).join('、');
  return `连接成功，发现 ${r.tools.length} 个工具${names?`：${names}${r.tools.length>10?'…':''}`:''}（仅连接测试，未调用业务工具）`;
}

/** Verify persisted discovery before enabling a connector for new agent tasks. */
export async function enableDiscoveredMcp(row: McpServer, current = authRevision()): Promise<string> {
  if (protectedMcp(row) || !current()) throw new Error('请重新选择连接器');
  const saved = await api<McpServer>('GET', `/api/mcp/servers/${encodeURIComponent(row.id)}`, undefined, { timeoutMs: 15000 });
  if (!current()) throw new Error('账号已变化，请重新连接');
  if (saved?.last_test_status !== 'connected' || !saved.tools?.length) {
    throw new Error('服务还没有提供可用能力，请检查配置后重试');
  }
  if (!saved.enabled) {
    const enabled = await api<McpServer>('POST', `/api/mcp/servers/${encodeURIComponent(row.id)}/toggle`, {});
    if (enabled?.enabled !== true) throw new Error('启用状态尚未确认，请重新检查');
  }
  if (!current()) throw new Error('账号已变化，请重新连接');
  return '已连接。新任务可以使用此连接器。';
}

export async function connectMcp(row: McpServer): Promise<string> {
  const current = authRevision();
  await testMcp(row);
  return enableDiscoveredMcp(row, current);
}
