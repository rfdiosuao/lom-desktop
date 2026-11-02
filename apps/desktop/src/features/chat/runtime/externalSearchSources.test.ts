import { describe, expect, it } from 'vitest';
import type { Msg } from '@/state/types';
import { isSearchToolName, parseSearchOutput, searchSourcesOf } from './searchSources';
import { applyAcpTool } from './toolImages';

/* 外部 Agent（Codex、Claude Code、CodeBuddy…）经 lom-search 桥调用元宝搜索：
 * 桥把核心返回的 data 原样作为 MCP 文本结果；CLI 再把它包一层回报给 Lom。 */
const data = { result: { results: [
  { title: '麓鸣官网', url: 'https://lom.example.com/', site: '麓鸣' },
  { title: '新闻', url: 'https://news.example.org/a', site: 'news', favicon: 'https://news.example.org/icon.png' },
] } };

describe('EXT-SEARCH 外部 Agent 调用元宝搜索也显示来源', () => {
  it.each([
    'lom_search', 'mcp__lom-search__lom_search', 'lom-search: lom_search', 'lom_search (lom-search MCP Server)', 'Lom Search / lom_search',
  ])('EXT-SEARCH recognizes the tool title %s', title => {
    expect(isSearchToolName(title)).toBe(true);
  });

  it.each(['lom_searcher', 'my_lom_search_tool', 'web_search', 'Bash'])('EXT-SEARCH does not mistake %s for Lom search', title => {
    expect(isSearchToolName(title)).toBe(false);
  });

  it('EXT-SEARCH unwraps MCP text results from the CLI, both as an object and as a bare array', () => {
    const text = JSON.stringify(data);
    for (const output of [JSON.stringify({ content: [{ type: 'text', text }], isError: false }), JSON.stringify([{ type: 'text', text }])]) {
      const sources = parseSearchOutput(output);
      expect(sources.map(s => s.url)).toEqual(['https://lom.example.com/', 'https://news.example.org/a']);
      expect(sources[1].favicon).toBe('https://news.example.org/icon.png');
    }
    // 原生信封仍然照常解析
    expect(parseSearchOutput(text)).toHaveLength(2);
  });

  it('EXT-SEARCH an ACP tool call that only reports text content still yields clickable sources', () => {
    const messages: Msg[] = [];
    applyAcpTool(messages, { update: { tool_call_id: 't1', title: 'lom-search: lom_search', status: 'in_progress', raw_input: { query: '麓鸣' } } });
    applyAcpTool(messages, { update: { tool_call_id: 't1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: JSON.stringify(data) } }] } });
    const sources = searchSourcesOf(messages);
    expect(sources.map(s => s.url)).toEqual(['https://lom.example.com/', 'https://news.example.org/a']);
    expect(sources[0].title).toBe('麓鸣官网');
  });

  it('EXT-SEARCH CodeBuddy calling through DeferExecuteTool still shows sources, recognized by the Lom search marker', () => {
    const marked = { source: 'Lom web search', untrusted_web_content: true, ...data };
    const messages: Msg[] = [];
    applyAcpTool(messages, { update: { tool_call_id: 'd1', title: 'DeferExecuteTool: {"params":{"count":10,"query":"手机智能体"}}', status: 'in_progress' } });
    applyAcpTool(messages, { update: { tool_call_id: 'd1', status: 'completed', raw_output: { type: 'text', text: JSON.stringify(marked) } } });
    expect(searchSourcesOf(messages).map(s => s.url)).toEqual(['https://lom.example.com/', 'https://news.example.org/a']);
  });

  it('EXT-SEARCH a deferred tool returning some other JSON with results is not mistaken for Lom search', () => {
    const messages: Msg[] = [];
    applyAcpTool(messages, { update: { tool_call_id: 'd2', title: 'DeferExecuteTool: {"params":{"to":"x"}}', status: 'completed', raw_output: { type: 'text', text: JSON.stringify({ source: 'Other search', ...data }) } } });
    expect(searchSourcesOf(messages)).toEqual([]);
  });

  it('EXT-SEARCH a shell command that merely prints a saved Lom search result is not shown as a search', () => {
    const marked = { source: 'Lom web search', ...data };
    const messages: Msg[] = [];
    applyAcpTool(messages, { update: { tool_call_id: 'sh', title: 'Bash: cat result.json', status: 'completed', raw_output: { type: 'text', text: JSON.stringify(marked) } } });
    expect(searchSourcesOf(messages)).toEqual([]);
  });

  it('EXT-SEARCH bridge errors and unrelated tools never show sources', () => {
    const messages: Msg[] = [];
    applyAcpTool(messages, { update: { tool_call_id: 'e1', title: 'lom_search', status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'search.bridge_unreachable: 不可用' } }] } });
    applyAcpTool(messages, { update: { tool_call_id: 'b1', title: 'Bash', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: JSON.stringify(data) } }] } });
    expect(searchSourcesOf(messages)).toEqual([]);
  });
});
