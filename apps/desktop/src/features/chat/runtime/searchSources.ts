import type { Msg } from '@/state/types';

/* ===== 联网搜索来源：从搜索工具的输出里取出网页列表 =====
 * 原生会话用 LomWebSearch；外部 Agent 经桥接调用时工具名是 lom_search（可能带 mcp__ 前缀）。
 * 只认识这两种输出信封，其他形状一律忽略，不在前端猜测。 */

export interface SearchSource {
  url: string;
  title: string;
  site: string;
  favicon?: string;
}

export const MAX_SEARCH_SOURCES = 10;
const MAX_TITLE_CHARS = 160;
const MAX_SITE_CHARS = 24;
const MAX_URL_CHARS = 2048;
const SEARCH_TOOLS = new Set(['LomWebSearch', 'lom_search']);

/** 与 links.ts / Rust web_link_open 对齐：空白、控制字符和反斜杠都不是可用地址 */
const UNSAFE_URL = /[\s\\\u0000-\u001f\u007f]/;

/** 结果里即使出现这些图标服务也不加载：来源条只请求搜索接口自己返回的 https 图标。 */
const THIRD_PARTY_ICON_HOSTS = ['google.com', 'googleusercontent.com', 'clearbit.com', 'brandfetch.io', 'icon.horse', 'gstatic.com', 'duckduckgo.com', 'yandex.net'];

const recordOf = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

/** 与 Rust 命令一致按 UTF-8 字节限制 URL 长度 */
const utf8Length = (s: string) => new TextEncoder().encode(s).length;
const usableUrl = (s: string) => !!s && !UNSAFE_URL.test(s) && utf8Length(s) <= MAX_URL_CHARS;

/** 去掉 mcp__<服务>__ 前缀后只认两种搜索工具名。
 *  外部 CLI 给工具起的标题各不相同（`lom_search`、`lom-search: lom_search`、`lom_search (MCP)`），
 *  所以也认标题里独立出现的工具名；`lom_searcher` 这类更长的名字不算。 */
export function isSearchToolName(name: string | undefined): boolean {
  if (!name) return false;
  const bare = name.replace(/^mcp__.+?__/, '').trim();
  if (SEARCH_TOOLS.has(bare)) return true;
  return /(?:^|[^A-Za-z0-9_])(?:LomWebSearch|lom_search)(?![A-Za-z0-9_])/.test(bare);
}

/** 合法的 http(s) 地址；凭据、超长和解析失败都丢弃 */
function webUrl(raw: string): string | null {
  const value = raw.trim();
  if (!usableUrl(value)) return null;
  try {
    const parsed = new URL(value);
    if (!usableUrl(parsed.href)) return null;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null; // 解析失败即不是可用链接
  }
}

const hostOf = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./i, ''); } catch { return ''; }
};

function blockedIconHost(host: string) {
  const h = host.toLowerCase();
  return THIRD_PARTY_ICON_HOSTS.some(blocked => h === blocked || h.endsWith(`.${blocked}`));
}

/** 只接受结果自带的 https 图标地址，且不指向已知第三方图标服务 */
function safeFavicon(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (!usableUrl(value)) return undefined;
  try {
    const parsed = new URL(value);
    if (!usableUrl(parsed.href)) return undefined;
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return undefined;
    if (blockedIconHost(parsed.hostname)) return undefined;
    return parsed.href;
  } catch {
    return undefined; // 图标地址无效时退回首字母色块
  }
}

function sourceOf(entry: unknown): SearchSource | null {
  const item = recordOf(entry);
  if (!item) return null;
  const url = typeof item.url === 'string' ? webUrl(item.url) : null;
  if (!url) return null;
  const host = hostOf(url);
  const site = clip(text(item.site) || host, MAX_SITE_CHARS);
  const title = clip(text(item.title) || site, MAX_TITLE_CHARS);
  const favicon = safeFavicon(item.favicon);
  return favicon ? { url, title, site, favicon } : { url, title, site };
}

/** 有的 CLI（Qoder、Qwen 等 Gemini 系）把工具文本放进 ``` 代码围栏再回报，先剥掉外层围栏 */
const unfence = (text: string) => {
  const m = /^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(text);
  return m ? m[1] : text;
};

/** 外部 CLI 把 MCP 工具结果原样转回来时多包一层：`{content:[{type:'text',text}]}`、这个数组，
 *  或者只有一个 `{type:'text',text}`（CodeBuddy 经 DeferExecuteTool 转调时）。取出其中的文本 */
function mcpTexts(value: unknown): string[] {
  const single = recordOf(value);
  if (single?.type === 'text' && typeof single.text === 'string') return [single.text];
  const list = Array.isArray(value) ? value : single?.content;
  if (!Array.isArray(list)) return [];
  return list.flatMap(item => {
    const entry = recordOf(item);
    return entry?.type === 'text' && typeof entry.text === 'string' ? [entry.text] : [];
  });
}

/** Lom 搜索结果自带的来源标记（lom-core lom_search.rs）。外部 CLI 转调时工具名千奇百怪，以结果本身为准 */
const LOM_SEARCH_SOURCE = 'Lom web search';

/** CLI 用来“转调另一个工具”的代理工具（CodeBuddy 的 DeferExecuteTool、use_mcp_tool、call_tool 等）：
 *  标题里看不到真实工具名，只能看结果。Bash、读文件这类普通工具即使输出了搜索 JSON 也不算搜索。 */
const TOOL_PROXY = /defer\w*tool|execute_?tool|use_?mcp_?tool|call_?tool|mcp_?tool_?call/i;
export const isToolProxy = (name: string | undefined) => !!name && TOOL_PROXY.test(name.replace(/^mcp__.+?__/, ''));

/** 结果是不是 Lom 搜索返回的（带来源标记且有 results 数组） */
export function isLomSearchOutput(output: unknown): boolean {
  return lomMarked(output);
}
function lomMarked(output: unknown, depth = 0): boolean {
  if (typeof output !== 'string' || !output.trim()) return false;
  let parsed: unknown;
  try { parsed = JSON.parse(unfence(output)); } catch { return false; } // 不是 JSON 就不是搜索结果
  if (depth === 0 && mcpTexts(parsed).some(inner => lomMarked(inner, 1))) return true;
  const payload = recordOf(parsed);
  const envelope = payload && 'success' in payload ? (payload.success === true ? recordOf(payload.data) : null) : payload;
  return envelope?.source === LOM_SEARCH_SOURCE && Array.isArray(recordOf(envelope.result)?.results);
}

/** 取出 results 数组；两种已知信封之外返回 null（外面多包一层 MCP 文本时先拆开） */
function resultsOf(output: unknown, depth = 0): unknown[] | null {
  if (typeof output !== 'string' || !output.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfence(output));
  } catch {
    return null; // 输出不是 JSON 时没有可展示的来源
  }
  if (depth === 0) {
    for (const inner of mcpTexts(parsed)) {
      const found = resultsOf(inner, 1);
      if (found) return found;
    }
  }
  const payload = recordOf(parsed);
  if (!payload) return null;
  let envelope: Record<string, unknown> | null = payload;
  if ('success' in payload) {
    if (payload.success !== true) return null;
    envelope = recordOf(payload.data);
  }
  const result = envelope ? recordOf(envelope.result) : null;
  return result && Array.isArray(result.results) ? result.results : null;
}

/** 解析一次工具输出：去重、截断、最多 10 条 */
export function parseSearchOutput(output: unknown): SearchSource[] {
  const results = resultsOf(output);
  if (!results) return [];
  const seen = new Set<string>();
  const out: SearchSource[] = [];
  for (const entry of results) {
    const source = sourceOf(entry);
    if (!source || seen.has(source.url)) continue;
    seen.add(source.url);
    out.push(source);
    if (out.length === MAX_SEARCH_SOURCES) break;
  }
  return out;
}

/** 结果没带图标时用网站自己的 /favicon.ico（只限 https 站点，仍不走第三方图标服务）；加载失败界面退回首字母 */
export function siteIcon(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname ? `${parsed.origin}/favicon.ico` : undefined;
  } catch {
    return undefined; // 地址无效时没有站点图标
  }
}

/** 一组工具调用里的来源：按调用顺序合并去重，运行中或失败的调用不展示 */
export function searchSourcesOf(items: Msg[]): SearchSource[] {
  const seen = new Set<string>();
  const out: SearchSource[] = [];
  for (const m of items) {
    if (m.type !== 'tool' || m.status === 'running' || m.status === 'error') continue;
    const proxied = isToolProxy(m.toolName) || isToolProxy(m.tool);
    if (!isSearchToolName(m.toolName) && !isSearchToolName(m.tool) && !(proxied && isLomSearchOutput(m.output))) continue;
    for (const source of parseSearchOutput(m.output)) {
      if (seen.has(source.url)) continue;
      seen.add(source.url);
      out.push(source);
      if (out.length === MAX_SEARCH_SOURCES) return out;
    }
  }
  return out;
}
