import { describe, expect, it } from 'vitest';
import type { Msg } from '@/state/types';
import { searchSourcesOf } from './searchSources';
import { applyAcpTool } from './toolImages';

/* 各外部 Agent 回报 Lom 搜索的真实格式。
 * CodeBuddy、Qoder 两种取自本机真实会话记录（2026-10-23，aionui-backend.db 中的 acp_tool_call）；
 * 其余按各 CLI 常见的 MCP 工具命名构造，用来防止同类问题在别的 Agent 上重现。 */
const envelope = JSON.stringify({ source: 'Lom web search', untrusted_web_content: true, result: { query: '手机智能体', results: [
  { authority_level: -1, title: '麓鸣官网', url: 'https://lom.example.com/', site: '麓鸣', date: '' },
  { authority_level: -1, title: '新闻', url: 'https://news.example.org/a', site: 'news', date: '' },
] } });
const text = (t: string) => [{ type: 'content', content: { type: 'text', text: t } }];
const URLS = ['https://lom.example.com/', 'https://news.example.org/a'];

const run = (start: Record<string, unknown>, end: Record<string, unknown>) => {
  const messages: Msg[] = [];
  applyAcpTool(messages, { session_id: 's', update: { session_update: 'tool_call', tool_call_id: 'x', status: 'in_progress', ...start } });
  applyAcpTool(messages, { session_id: 's', update: { session_update: 'tool_call_update', tool_call_id: 'x', ...end } });
  return searchSourcesOf(messages).map(s => s.url);
};

describe('EXT-SEARCH 每种外部 Agent 的 Lom 搜索都显示来源', () => {
  it('EXT-SEARCH CodeBuddy (real record): DeferExecuteTool with a {type,text,status} raw output', () => {
    expect(run({ title: 'DeferExecuteTool', kind: 'execute', raw_input: { params: { query: '手机智能体', count: 10 }, tool_name: 'mcp__lom-search__lom_search' } },
      { status: 'completed', title: 'DeferExecuteTool', raw_output: { type: 'text', text: envelope, status: 'success' }, content: text(envelope) })).toEqual(URLS);
  });

  it('EXT-SEARCH Qoder (real record): "lom_search (lom-search MCP Server)" with the envelope as raw output', () => {
    expect(run({ title: 'lom_search (lom-search MCP Server)', raw_input: { query: '手机智能体', count: 10 } },
      { status: 'completed', raw_output: envelope, content: text(envelope) })).toEqual(URLS);
  });

  it('EXT-SEARCH Gemini-family CLIs that only report fenced text content', () => {
    expect(run({ title: 'lom_search (lom-search MCP Server)' }, { status: 'completed', content: text(`\`\`\`\n${envelope}\n\`\`\``) })).toEqual(URLS);
    expect(run({ title: 'lom_search (lom-search MCP Server)' }, { status: 'completed', content: text(`\`\`\`json\n${envelope}\n\`\`\``) })).toEqual(URLS);
  });

  it.each([
    ['Claude Code', 'mcp__lom-search__lom_search'],
    ['Codex', 'lom-search.lom_search'],
    ['Codex (slash form)', 'lom-search/lom_search'],
    ['Kimi / generic', 'lom_search'],
    ['generic call wrapper', 'use_mcp_tool'],
  ])('EXT-SEARCH %s title "%s" with text-only content', (_agent, title) => {
    expect(run({ title }, { status: 'completed', content: text(envelope) })).toEqual(URLS);
  });

  it('EXT-SEARCH a failed search (real Qoder rate-limit record) shows no sources', () => {
    expect(run({ title: 'lom_search (lom-search MCP Server)' },
      { status: 'failed', raw_output: 'search.rate_limit: Lom search request was rejected', content: text('```\nsearch.rate_limit: Lom search request was rejected\n```') })).toEqual([]);
  });

  it('EXT-SEARCH lom_fetch through the same wrapper is not a search and shows no source bar', () => {
    const fetched = JSON.stringify({ source: 'Lom web search', untrusted_web_content: true, result: { content: '# 页面正文' } });
    expect(run({ title: 'DeferExecuteTool', raw_input: { tool_name: 'mcp__lom-search__lom_fetch' } },
      { status: 'completed', raw_output: { type: 'text', text: fetched, status: 'success' } })).toEqual([]);
  });
});
