import { describe, expect, it } from 'vitest';
import { isSearchToolName, parseSearchOutput, searchSourcesOf } from './searchSources';
import type { Msg } from '@/state/types';

const native = (results: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({
  source: 'Lom web search',
  untrusted_web_content: true,
  result: { query: '测试', results },
  billable: true,
  ...extra,
});

const bridge = (results: unknown[]) => JSON.stringify({ success: true, data: { result: { query: '测试', results } } });

const item = (over: Record<string, unknown> = {}) => ({
  title: '示例文章', url: 'https://example.com/a', site: 'example.com',
  favicon: 'https://example.com/favicon.ico', content: '正文', ...over,
});

const tool = (over: Partial<Msg>): Msg => ({ id: 'm1', type: 'tool', at: 1, callId: 'c1', toolName: 'LomWebSearch', status: 'done', ...over });

describe('D31 AC-1 搜索输出信封', () => {
  it('parses the native LomWebSearch envelope', () => {
    const sources = parseSearchOutput(native([item()]));
    expect(sources).toHaveLength(1);
    expect(sources[0]).toEqual({
      url: 'https://example.com/a', title: '示例文章', site: 'example.com', favicon: 'https://example.com/favicon.ico',
    });
  });

  it('parses the bridged lom_search envelope', () => {
    expect(parseSearchOutput(bridge([item()]))).toHaveLength(1);
  });

  it('ignores broken JSON, failed bridges, empty results and unknown shapes', () => {
    expect(parseSearchOutput('{oops')).toEqual([]);
    expect(parseSearchOutput(JSON.stringify({ success: false, data: { result: { results: [item()] } } }))).toEqual([]);
    expect(parseSearchOutput(native([]))).toEqual([]);
    expect(parseSearchOutput(JSON.stringify({ result: { results: 'not-an-array' } }))).toEqual([]);
    expect(parseSearchOutput(JSON.stringify({ data: { result: { results: [item()] } } }))).toEqual([]);
    expect(parseSearchOutput(JSON.stringify([item()]))).toEqual([]);
    expect(parseSearchOutput(JSON.stringify({ result: { results: [null, 42, 'x'] } }))).toEqual([]);
    expect(parseSearchOutput(undefined)).toEqual([]);
  });

  it('recognizes both tool names with the mcp prefix stripped', () => {
    expect(isSearchToolName('LomWebSearch')).toBe(true);
    expect(isSearchToolName('mcp__lom-search__lom_search')).toBe(true);
    expect(isSearchToolName('lom_search')).toBe(true);
    expect(isSearchToolName('WebSearch')).toBe(false);
    expect(isSearchToolName(undefined)).toBe(false);
  });
});

describe('D31 AC-2 去重、协议与截断', () => {
  it('dedupes by URL and keeps first-seen order', () => {
    const sources = parseSearchOutput(native([
      item({ url: 'https://b.example/1', title: 'B' }),
      item({ url: 'https://a.example/1', title: 'A' }),
      item({ url: 'https://b.example/1', title: 'B 重复' }),
    ]));
    expect(sources.map(s => s.title)).toEqual(['B', 'A']);
  });

  it('drops non-http, credentialed, unsafe and over-long URLs', () => {
    const sources = parseSearchOutput(native([
      item({ url: 'javascript:alert(1)' }),
      item({ url: 'file:///etc/passwd' }),
      item({ url: 'ftp://example.com/a' }),
      item({ url: 'https://user:pass@example.com/a' }),
      item({ url: 'https://example.com\\@evil.com/a' }),
      item({ url: 'https://example.com/a\tb' }),
      item({ url: 'https://example.com/a b' }),
      item({ url: `https://example.com/${'a'.repeat(2048)}` }),
      item({ url: 'https://ok.example/a' }),
    ]));
    expect(sources.map(s => s.url)).toEqual(['https://ok.example/a']);
  });

  it('accepts a URL exactly at the 2048-byte limit', () => {
    const exact = `https://example.com/${'a'.repeat(2028)}`;
    expect(exact.length).toBe(2048);
    expect(parseSearchOutput(native([item({ url: exact })]))).toHaveLength(1);
  });

  it('falls back to the host and clips long titles and site names', () => {
    const [source] = parseSearchOutput(native([
      item({ title: '标'.repeat(300), site: '站'.repeat(60), url: 'https://www.example.com/x' }),
    ]));
    expect(source.site).toBe(`${'站'.repeat(24)}…`);
    expect(source.title).toBe(`${'标'.repeat(160)}…`);
    const [noSite] = parseSearchOutput(native([item({ site: '', url: 'https://www.example.org/x' })]));
    expect(noSite.site).toBe('example.org');
  });

  it('keeps at most ten sources', () => {
    const sources = parseSearchOutput(native(Array.from({ length: 15 }, (_, i) => item({ url: `https://example.com/${i}` }))));
    expect(sources).toHaveLength(10);
    expect(sources.at(-1)?.url).toBe('https://example.com/9');
  });

  it('only accepts https favicons from the result and blocks third-party icon services', () => {
    const [https] = parseSearchOutput(native([item({ favicon: 'https://cdn.example.com/i.png' })]));
    expect(https.favicon).toBe('https://cdn.example.com/i.png');
    const [http] = parseSearchOutput(native([item({ favicon: 'http://cdn.example.com/i.png' })]));
    expect(http.favicon).toBeUndefined();
    for (const favicon of [
      'https://www.google.com/s2/favicons?domain=example.com',
      'https://s2.googleusercontent.com/s2/favicons?domain=example.com',
      'https://logo.clearbit.com/example.com',
      'https://cdn.brandfetch.io/example.com',
      'https://icon.horse/icon/example.com',
      'https://www.gstatic.com/faviconV2?url=example.com',
      'https://icons.duckduckgo.com/ip3/example.com.ico',
      'https://favicon.yandex.net/favicon/example.com',
    ]) {
      expect(parseSearchOutput(native([item({ favicon })]))[0].favicon).toBeUndefined();
    }
  });
});

describe('D31 AC-3/AC-8 工具组与历史回放', () => {
  it('merges sources across calls in order and skips running or failed calls', () => {
    const items = [
      tool({ id: 'm1', callId: 'c1', output: native([item({ url: 'https://a.example/1' }), item({ url: 'https://b.example/1' })]) }),
      tool({ id: 'm2', callId: 'c2', toolName: 'mcp__lom-search__lom_search', output: bridge([item({ url: 'https://b.example/1' }), item({ url: 'https://c.example/1' })]) }),
      tool({ id: 'm3', callId: 'c3', output: native([item({ url: 'https://running.example/1' })]), status: 'running' }),
      tool({ id: 'm3b', callId: 'c3b', output: native([item({ url: 'https://failed.example/1' })]), status: 'error' }),
      tool({ id: 'm4', callId: 'c4', toolName: 'Bash', output: native([item({ url: 'https://other.example/1' })]) }),
      tool({ id: 'm5', callId: 'c5', toolName: undefined, tool: 'mcp__lom-search__lom_search', output: bridge([item({ url: 'https://acp.example/1' })]) }),
    ];
    expect(searchSourcesOf(items).map(s => s.url)).toEqual([
      'https://a.example/1', 'https://b.example/1', 'https://c.example/1', 'https://acp.example/1',
    ]);
  });
});
