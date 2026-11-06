import { expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api }));
import { saveMcp } from './mcpManager';

const fail = async (json: string) => saveMcp('docs', json).then(() => { throw new Error('should reject'); }, (e: Error & { code?: string; detail?: string }) => e);

it('SET-MCP-01 #438 malformed JSON gives a coded Chinese message with the position and keeps the original text as detail', async () => {
  const error = await fail('{\n  "type": "http",\n  "url": }');
  expect(error.code).toBe('mcp.config_json');
  expect(error.message).toMatch(/^mcp\.config_json：/);
  expect(error.message).toMatch(/第 3 行/);
  expect(error.message).not.toMatch(/Unexpected|Expected|token/i);
  expect(error.message).toMatch(/第 3 行第 10 列/);
  expect(error.detail).toBeTruthy();
  expect(m.api).not.toHaveBeenCalled();
});

it('SET-MCP-01 #438 an invalid URL is explained in Chinese with a code and the raw exception as detail', async () => {
  const error = await fail('{"type":"http","url":"not a url"}');
  expect(error.code).toBe('mcp.config_url');
  expect(error.message).toContain('mcp.config_url：');
  expect(error.message).not.toContain('Invalid URL');
  expect(error.detail).toContain('Invalid URL');
});

it.each([
  ['{"type":"ftp"}', 'mcp.config_type'],
  ['{"type":"stdio"}', 'mcp.config_command'],
  ['{"type":"http","url":"https://a.test/mcp","headers":{"a":1}}', 'mcp.config_headers'],
  ['null', 'mcp.config_type'],
])('SET-MCP-01 #438 %s carries code %s', async (json, code) => {
  expect((await fail(json)).code).toBe(code);
});

it.each([
  ['', 1, 1],
  ['{"a":1,}', 1, 8],
  ['{"a" 1}', 1, 6],
  ['[1,\n2,\n x]', 3, 2],
  ['{"a":"b', 1, 8],
  ['{"a":1} extra', 1, 9],
])('SET-MCP-01 #438 locates the syntax error in %j at line %i column %i', async (json, line, column) => {
  const error = await fail(json);
  expect(error.message).toContain(`第 ${line} 行第 ${column} 列`);
});
