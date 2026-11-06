import { jsonErrorPlace } from './jsonErrorPlace';
import type { McpTransport } from './mcpManager';

/** 配置不合法：message 是「错误码：中文说明」，浏览器/运行时给出的英文原始异常放在 detail，供界面作为详情展示。 */
export class McpConfigError extends Error {
  constructor(readonly code: string, text: string, readonly detail?: string) {
    super(`${code}：${text}`);
    this.name = 'McpConfigError';
  }
}

const rawText = (error: unknown) => error instanceof Error ? error.message : String(error);

function readJson(json: string): McpTransport {
  try { return JSON.parse(json) as McpTransport; }
  catch (error) {
    const place = jsonErrorPlace(json);
    const where = place ? `（出错位置：第 ${place.line} 行第 ${place.column} 列附近）` : '';
    throw new McpConfigError('mcp.config_json', `连接配置不是有效的 JSON${where}，请检查括号、引号和逗号。`, rawText(error));
  }
}

function checkUrl(t: McpTransport) {
  let url: URL;
  try { url = new URL(t.url || ''); }
  catch (error) { throw new McpConfigError('mcp.config_url', '服务地址无效，请填写以 http:// 或 https:// 开头的完整地址。', rawText(error)); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new McpConfigError('mcp.config_url', '请输入有效的 HTTP(S) 地址；账号密码不要写进地址，请放入 headers。');
  }
}

export function parseTransport(json: string): McpTransport {
  const t = readJson(json);
  if (!t || !['stdio', 'http', 'sse'].includes(t.type)) throw new McpConfigError('mcp.config_type', 'transport.type 需要是 stdio、http 或 sse。');
  if (t.type === 'stdio') {
    if (!t.command?.trim() || (t.args && (!Array.isArray(t.args) || t.args.some(x => typeof x !== 'string')))) {
      throw new McpConfigError('mcp.config_command', '请填写启动命令，参数需要是字符串数组。');
    }
  } else checkUrl(t);
  for (const obj of [t.env, t.headers]) {
    if (obj && (Array.isArray(obj) || typeof obj !== 'object' || Object.values(obj).some(x => typeof x !== 'string'))) {
      throw new McpConfigError('mcp.config_headers', 'env 和 headers 必须是字符串键值对象。');
    }
  }
  return t;
}
