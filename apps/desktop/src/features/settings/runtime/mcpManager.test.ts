import { expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api }));
import { testMcp, type McpServer } from './mcpManager';
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
