import { api, CoreError } from '@/core/client';
import { authRevision, onAuthChange } from '@/features/account/runtime/authScope';
import { protectedMcp, testMcp, type McpServer } from './mcpManager';

interface Capabilities { version: number; supported: boolean }
export function oauthClearable(row: McpServer) {
  if (protectedMcp(row) || row.transport.type !== 'http') return false;
  try { const u = new URL(row.transport.url || ''); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; }
  catch { return false; }
}
export function oauthEligible(row: McpServer) {
  return oauthClearable(row) && !Object.keys(row.transport.headers ?? {}).length;
}
function requireEligible(row: McpServer) {
  if (!oauthEligible(row)) throw new Error('OAuth 需要非内部 HTTP 服务，且 headers 留空；凭据由系统安全存储管理。');
  const url = new URL(row.transport.url || '');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('OAuth 服务需要不含凭据、查询参数和片段的 HTTPS 地址。');
}
async function supported(signal?: AbortSignal) {
  try {
    const result = await api<Capabilities>('GET', '/api/mcp/oauth/v2/capabilities', undefined, { signal, timeoutMs: 10000 });
    if (result?.version !== 1 || result.supported !== true) throw new Error('unsupported');
  } catch (e) {
    if (signal?.aborted) throw new Error('MCP 授权已取消');
    if (e instanceof CoreError && e.code !== 'HTTP_404') throw e;
    throw new Error('当前核心不支持安全 MCP OAuth，请更新 Lom 核心；没有发起旧版授权流程。');
  }
}
function message(error: unknown) {
  const text = error instanceof Error ? error.message : 'MCP 授权失败';
  const code = text.match(/mcp\.oauth\.[a-z_]+/)?.[0];
  const hints: Record<string, string> = {
    'mcp.oauth.denied': '你没有允许本次授权，服务没有连接。',
    'mcp.oauth.callback_timeout': '等待浏览器授权超时，请重新发起授权。',
    'mcp.oauth.cancelled': '本次授权已取消。',
    'mcp.oauth.secret_store': '系统安全存储不可用，请解锁钥匙串后重试。',
    'mcp.oauth.cross_origin_unsupported': '此服务使用跨域授权服务器，当前版本尚不支持。',
    'mcp.oauth.registration_failed': '服务未接受 Lom 的客户端注册，请核对服务配置。',
    'mcp.oauth.refresh_failed': '令牌续期暂时失败，本次未调用业务工具。请稍后测试连接，若授权失效再重新授权。',
    'mcp.oauth.refresh_network': '续期网络请求失败，本次未调用业务工具，请稍后测试连接。',
    'mcp.oauth.refresh_rejected': '服务拒绝了令牌续期，请重新授权。',
    'mcp.oauth.refresh_response_invalid': '服务返回了无效的续期结果，本次未调用业务工具。',
    'mcp.oauth.login_required': '授权已失效，请重新授权。',
    'mcp.oauth.busy': '已有授权正在进行，请完成或取消后重试。',
  };
  return code ? hints[code] ?? `授权未完成（${code}），请核对服务和核心版本。` : text;
}
export async function authorizeMcp(row: McpServer, signal: AbortSignal): Promise<string> {
  requireEligible(row);
  const current = authRevision(), requestId = crypto.randomUUID();
  let started = false, completed = false, cancelSent = false;
  const cancel = () => {
    if (started && !cancelSent) { cancelSent = true; void api('POST', '/api/mcp/oauth/v2/cancel', { server_id: row.id, request_id: requestId }, { timeoutMs: 10000 })
      .catch(() => { /* Cancellation acknowledgement is unknown; keep the cancelled outcome and require provider-side review, never report success. */ }); }
  };
  const unsubscribe = onAuthChange(cancel);
  signal.addEventListener('abort', cancel, { once: true });
  const check = () => { if (!current() || signal.aborted) throw new Error('MCP 授权已取消或账号已变化；已完成的服务器授权请在服务端核对。'); };
  try {
    await supported(signal); check(); started = true;
    const result = await api<{ success: boolean }>('POST', '/api/mcp/oauth/v2/login', { server_id: row.id, request_id: requestId }, { signal, timeoutMs: 260000 });
    check();
    if (result?.success !== true) throw new Error('MCP 授权没有完成，请重新发起并在浏览器核对权限。');
    completed = true;
    const saved = await api<{ authenticated: boolean }>('POST', '/api/mcp/oauth/v2/status', { server_id: row.id }, { signal, timeoutMs: 10000 });
    check();
    if (saved?.authenticated !== true) throw new Error('核心未确认凭据已保存，请重新授权。');
    try {
      const connection = await testMcp(row, { signal }); check();
      return `授权已保存到系统安全存储。${connection}。需要使用时启用服务，再新建任务或重新保存助理的服务选择。`;
    } catch (e) {
      check();
      throw new Error(`授权已保存，但工具读取尚未确认：${e instanceof Error ? e.message : '连接失败'}。可重新测试连接，请勿重复执行业务操作。`);
    }
  } catch (e) {
    check(); throw new Error(message(e));
  } finally {
    if (started && (!completed || signal.aborted || !current())) cancel();
    signal.removeEventListener('abort', cancel); unsubscribe();
  }
}
export async function clearMcpOAuth(row: McpServer): Promise<string> {
  if (!oauthClearable(row)) throw new Error('请选择有效的外部 HTTPS HTTP 服务');
  const current = authRevision(); await supported();
  if (!current()) throw new Error('账号已变化，未清除授权');
  const result = await api<{ success: boolean }>('POST', '/api/mcp/oauth/v2/logout', { server_id: row.id }, { timeoutMs: 30000 });
  if (!current() || result?.success !== true) throw new Error('清除结果未确认，请重新读取授权状态。');
  return '本机凭据已清除，后续 OAuth 调用需重新授权；服务端授权记录可在 Activepieces 等对应服务中撤销。';
}
