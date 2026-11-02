import type { Endpoint } from './types';

/* ===== 访问 lom-core 的唯一入口（REST） =====
 * 页面和组件不直接 fetch；每个请求都带启动令牌，失败一律抛出带错误码的 CoreError。 */

export class CoreError extends Error {
  constructor(public code: string, message: string, public status?: number) {
    super(message);
    this.name = 'CoreError';
  }
}

let endpoint: Endpoint | null = null;
export const setEndpoint = (e: Endpoint) => { endpoint = e; };
export const getEndpoint = () => endpoint;

const headers = (json: boolean): Record<string, string> => ({
  ...(json ? { 'content-type': 'application/json' } : {}),
  ...(endpoint?.token ? { 'x-lom-token': endpoint.token } : {}),
});

export interface RequestOptions { signal?: AbortSignal; timeoutMs?: number; }

function abortable<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return request;
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(new CoreError('LOM_CORE_CANCELLED', '请求已取消或超时，执行状态尚未确认'));
    };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    request.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function requestControl(options: RequestOptions) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timer = options.timeoutMs === undefined ? undefined : setTimeout(abort, options.timeoutMs);
  return { signal: controller.signal, clear: () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); } };
}

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  if (!endpoint) throw new CoreError('LOM_CORE_NOT_READY', '核心服务还没有启动');
  const control = requestControl(options);
  if (control.signal.aborted) { control.clear(); throw new CoreError('LOM_CORE_CANCELLED', '请求已取消，执行状态尚未确认'); }
  const request = (async () => {
    let res: Response;
    try {
      res = await fetch(endpoint.url + path, { method, signal: control.signal, headers: headers(body !== undefined), body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new CoreError('LOM_CORE_UNREACHABLE', `无法连接核心服务（${e instanceof Error ? e.message : String(e)}）`);
    }
    return parseResponse<T>(res);
  })();
  try { return await abortable(request, control.signal); }
  finally { control.clear(); }
}

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let json: { success?: boolean; data?: T; error?: string; code?: string };
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new CoreError('LOM_CORE_BAD_RESPONSE', `核心服务返回了无法解析的内容（HTTP ${res.status}）`, res.status);
  }
  if (!res.ok || json.success === false) {
    throw new CoreError(json.code || `HTTP_${res.status}`, json.error || `请求失败（HTTP ${res.status}）`, res.status);
  }
  return json.data as T;
}

/** 上传文件到核心的托管目录（粘贴、拖入的图片等），返回服务器上的绝对路径，发送时作为 upload 附件 */
export async function uploadFile(file: Blob, fileName: string, conversationId?: string): Promise<string> {
  if (!endpoint) throw new CoreError('LOM_CORE_NOT_READY', '核心服务还没有启动');
  const form = new FormData();
  form.append('file_name', fileName);
  if (conversationId) form.append('conversation_id', conversationId);
  form.append('file', file, fileName);
  let res: Response;
  try {
    res = await fetch(`${endpoint.url}/api/fs/upload`, { method: 'POST', headers: headers(false), body: form });
  } catch (e) {
    throw new CoreError('LOM_CORE_UNREACHABLE', `无法连接核心服务（${e instanceof Error ? e.message : String(e)}）`);
  }
  return parseResponse<string>(res);
}

/** WebSocket 地址（浏览器无法给 WebSocket 设置请求头，令牌放在查询参数里） */
export const wsUrl = () => {
  if (!endpoint) return '';
  const u = endpoint.url.replace(/^http/, 'ws');
  return `${u}/ws${endpoint.token ? `?token=${encodeURIComponent(endpoint.token)}` : ''}`;
};

/** 本地文件流地址（用于 <img> 等无法自定义请求头的场景） */
export const fileStreamUrl = (absPath: string) => {
  if (!endpoint) return '';
  const q = new URLSearchParams({ kind: 'local', path: absPath, ...(endpoint.token ? { token: endpoint.token } : {}) });
  return `${endpoint.url}/api/fs/stream?${q.toString()}`;
};
