import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ api: vi.fn(), test: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api, CoreError: class extends Error {} }));
vi.mock('./mcpManager', () => ({ protectedMcp: (r: { builtin?: boolean; name: string }) => r.builtin || r.name.startsWith('lom-phone-'), testMcp: m.test }));
import { authorizeMcp, clearMcpOAuth } from './mcpOAuth';
import { beginAuthChange } from '@/features/account/runtime/authScope';
import type { McpServer } from './mcpManager';
const row = { id: 'server', name: 'Activepieces', transport: { type: 'http', url: 'https://example.com/mcp/platform' } } as McpServer;
beforeEach(() => {
  beginAuthChange(); vi.clearAllMocks();
  m.api.mockImplementation(async (_method, path) => path.endsWith('capabilities') ? { version: 1, supported: true } : path.endsWith('status') ? { authenticated: true } : { success: true });
  m.test.mockResolvedValue('连接成功，发现 1 个工具：list_flows');
});
it('MCP-OAUTH-01 confirms persisted authorization and actual tools without returning credentials', async () => {
  const result = await authorizeMcp(row, new AbortController().signal);
  expect(result).toContain('list_flows'); expect(result).toContain('系统安全存储');
  const login = m.api.mock.calls.find(c => c[1].endsWith('/login'))!;
  expect(login[2]).toMatchObject({ server_id: 'server' }); expect(login[2].request_id).toMatch(/^[\w-]{36}$/);
  expect(m.test).toHaveBeenCalledWith(row, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(JSON.stringify(m.api.mock.calls)).not.toContain('access_token');
});
it('MCP-OAUTH-01 old core cannot start legacy login', async () => {
  m.api.mockResolvedValue({ supported: true });
  await expect(authorizeMcp(row, new AbortController().signal)).rejects.toThrow('更新');
  expect(m.api.mock.calls.some(c => c[1].endsWith('/login'))).toBe(false);
});
it.each([undefined, {}, { success: false }])('MCP-OAUTH-01 incomplete login never reports success (%j)', async response => {
  m.api.mockImplementation(async (_method, path) => path.endsWith('capabilities') ? { version: 1, supported: true } : response);
  await expect(authorizeMcp(row, new AbortController().signal)).rejects.toThrow('没有完成');
  expect(m.test).not.toHaveBeenCalled();
});
it('MCP-OAUTH-01 missing stored grant never tests tools', async () => {
  m.api.mockImplementation(async (_method, path) => path.endsWith('capabilities') ? { version: 1, supported: true } : path.endsWith('status') ? {} : { success: true });
  await expect(authorizeMcp(row, new AbortController().signal)).rejects.toThrow('未确认凭据'); expect(m.test).not.toHaveBeenCalled();
});
it('MCP-OAUTH-01 tool discovery failure preserves the distinct saved-grant outcome', async () => {
  m.test.mockRejectedValue(new Error('工具读取失败'));
  await expect(authorizeMcp(row, new AbortController().signal)).rejects.toThrow('授权已保存，但工具读取尚未确认');
});
it.each(['cancel', 'account'])('MCP-OAUTH-01 %s invalidates the exact pending login and late completion', async mode => {
  const controller = new AbortController(); let resolve!: (x: { success: boolean }) => void;
  m.api.mockImplementation(async (_method, path) => {
    if (path.endsWith('capabilities')) return { version: 1, supported: true };
    if (path.endsWith('/login')) return new Promise(r => { resolve = r; });
    return { success: true };
  });
  const result = authorizeMcp(row, controller.signal); const rejected = expect(result).rejects.toThrow('取消或账号');
  await vi.waitFor(() => expect(resolve).toBeDefined());
  if (mode === 'cancel') controller.abort(); else beginAuthChange();
  resolve({ success: true }); await rejected;
  const login = m.api.mock.calls.find(c => c[1].endsWith('/login'))!;
  expect(m.api.mock.calls.find(c => c[1].endsWith('/cancel'))?.[2]).toEqual(login[2]);
  expect(m.test).not.toHaveBeenCalled();
});
it('MCP-OAUTH-01 internal, stdio, custom headers and insecure resources cannot begin OAuth', async () => {
  for (const input of [{ ...row, builtin: true }, { ...row, transport: { type: 'stdio', command: 'x' } }, { ...row, transport: { type: 'http', url: 'http://example.com/mcp' } }, { ...row, transport: { ...row.transport, headers: { Authorization: 'fixture' } } }]) {
    await expect(authorizeMcp(input as McpServer, new AbortController().signal)).rejects.toThrow();
  }
  expect(m.api).not.toHaveBeenCalled();
});
it('MCP-OAUTH-01 local logout is explicit and does not claim server revocation', async () => {
  expect(await clearMcpOAuth(row)).toContain('服务端授权记录');
  expect(m.api).toHaveBeenCalledWith('POST', '/api/mcp/oauth/v2/logout', { server_id: row.id }, expect.any(Object));
});

it('MCP-OAUTH-01 previous OAuth credentials can be cleared after adding manual headers', async () => {
 const manual = {...row,transport:{...row.transport,headers:{Authorization:'manual-fixture'}}};
 expect(await clearMcpOAuth(manual)).toContain('本机凭据已清除');
});

it('MCP-OAUTH-01 a lost login response cancels the exact native attempt', async () => {
 m.api.mockImplementation(async (_method,path)=>{if(path.endsWith('capabilities'))return {version:1,supported:true};if(path.endsWith('/login'))throw new Error('response lost');return {success:true};});
 await expect(authorizeMcp(row,new AbortController().signal)).rejects.toThrow('response lost');
 const login=m.api.mock.calls.find(c=>c[1].endsWith('/login'))!;
 expect(m.api.mock.calls.find(c=>c[1].endsWith('/cancel'))?.[2]).toEqual(login[2]);
 expect(m.test).not.toHaveBeenCalled();
});
