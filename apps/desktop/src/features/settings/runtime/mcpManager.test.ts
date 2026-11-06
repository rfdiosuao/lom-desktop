import { expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api }));
import { connectMcp, testMcp, type McpServer } from './mcpManager';
const server = { id: 'docs', name: 'Docs', transport: { type: 'http', url: 'https://example.com/mcp' } } as McpServer;
it.each([undefined, {}, { success: true }, { success: 'yes', tools: [] }, { success: true, tools: {} }, { success: true, tools: [{}] }])('MCP-02 AC5 invalid connection response is never reported as zero-tool success (%j)', async response => {
  m.api.mockResolvedValue(response);
  await expect(testMcp(server)).rejects.toThrow();
});
it('MCP-02 AC5 successful discovery lists actual tool names and empty tools remains valid', async () => {
  m.api.mockResolvedValue({ success: true, tools: [{ name: 'search_docs' }] });
  expect(await testMcp(server)).toContain('search_docs');
  m.api.mockResolvedValue({ success: true, tools: [] });
  expect(await testMcp(server)).toContain('0 个工具');
});
it('MCP-02 AC5 OAuth requirements are surfaced without pretending to complete login', async () => {
  m.api.mockResolvedValue({ success: false, needs_auth: true, error: 'private response' });
  await expect(testMcp(server)).rejects.toThrow('授权');
});

it('enables a connector only after core has recorded at least one callable capability', async () => {
  m.api.mockReset().mockResolvedValueOnce({ success: true, tools: [] })
    .mockResolvedValueOnce({ ...server, last_test_status: 'connected', tools: [] });
  await expect(connectMcp(server)).rejects.toThrow('没有提供可用能力');
  expect(m.api).toHaveBeenCalledTimes(2);
  const tools = [{ name: 'search_docs' }];
  m.api.mockReset().mockResolvedValueOnce({ success: true, tools })
    .mockResolvedValueOnce({ ...server, enabled: false, last_test_status: 'connected', tools })
    .mockResolvedValueOnce({ enabled: true });
  await expect(connectMcp(server)).resolves.toContain('新任务可以使用');
  expect(m.api).toHaveBeenLastCalledWith('POST', '/api/mcp/servers/docs/toggle', {});
});
