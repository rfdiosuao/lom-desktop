import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { api } from '@/core/client';
import { phoneRpc } from '@/features/phones/runtime/phoneRpc';
import { base64 } from '@/features/phones/runtime/phoneFiles';
import type { ChatImage, ChatFile, FileState, FileData, ImageCacheKey, ImageCacheWrite } from '@/core/remoteWire';

export interface ImageContext { account: string; conversation: string; message: string; workspace?: string; phone?: { device: string; session: string }; attachment?: ChatFile }
export interface ReplyImage { data: string; name: string; warning?: string }
export const IMAGE_MAX = 15 * 1024 * 1024;
const pending = new Map<string, Promise<ReplyImage>>();
const hash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)), b => b.toString(16).padStart(2, '0')).join('');

export function imageData(bytes: Uint8Array): string {
  if (bytes.length > IMAGE_MAX) throw new Error('图片超过 15 MB，暂不能内嵌显示');
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b));
  const mime = ascii(0, 8) === '\x89PNG\r\n\x1a\n' ? 'png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpeg'
    : ['GIF87a', 'GIF89a'].includes(ascii(0, 6)) ? 'gif' : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' ? 'webp' : '';
  if (!mime) throw new Error('文件不是支持的图片（PNG、JPEG、GIF、WebP）');
  return `data:image/${mime};base64,${base64(bytes)}`;
}
function decode(data: string) {
  if (!/^data:image\/(png|jpeg|gif|webp);base64,/.test(data) || data.length > IMAGE_MAX * 4 / 3 + 64) throw new Error('图片格式或大小不支持');
  return Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), c => c.charCodeAt(0));
}
async function phoneImage(source: string, context: ImageContext): Promise<string> {
  const phone = context.phone!;
  const request: ChatImage = { session_id: phone.session, source };
  const file = context.attachment
    ? await phoneRpc<FileState>(phone.device, 'chat.file', context.attachment)
    : await phoneRpc<FileState>(phone.device, 'chat.image', request);
  const size = Number(file.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > IMAGE_MAX) throw new Error('手机图片超过 15 MB 或文件无效');
  const bytes = new Uint8Array(size);
  let offset = 0;
  while (offset < size) {
    const chunk = await phoneRpc<FileData>(phone.device, 'file.read', { id: file.id, offset: String(offset) });
    const data = Uint8Array.from(atob(chunk.data), c => c.charCodeAt(0));
    if (!data.length || offset + data.length > size || Number(chunk.next) !== offset + data.length) throw new Error('手机图片分片不完整');
    bytes.set(data, offset); offset += data.length;
  }
  if (await hash(bytes) !== file.sha256) throw new Error('手机图片完整性校验失败');
  return imageData(bytes);
}
async function remoteImage(source: string) {
  const url = new URL(source);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('只支持 HTTPS 图片地址');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
    if (!res.ok || !res.url.startsWith('https:')) throw new Error('图片地址已失效或无法访问');
    if (Number(res.headers.get('content-length')) > IMAGE_MAX) throw new Error('图片超过 15 MB');
    const reader = res.body?.getReader(); if (!reader) throw new Error('图片没有内容');
    const parts: Uint8Array[] = []; let size = 0;
    while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length;
      if (size > IMAGE_MAX) { await reader.cancel(); throw new Error('图片超过 15 MB'); } parts.push(chunk.value); }
    const bytes = new Uint8Array(size); let at = 0; for (const part of parts) { bytes.set(part, at); at += part.length; }
    return imageData(bytes);
  } finally { clearTimeout(timer); }
}
async function acquire(source: string, context: ImageContext, key: string): Promise<ReplyImage> {
  let warning = '';
  const request: ImageCacheKey = { key };
  let cached: string | null = null;
  try { cached = await invoke<string | null>('reply_image_read', { request }); }
  catch { warning = '历史图片缓存读取失败，已尝试读取原图'; }
  const name = source.split(/[/?#]/).filter(Boolean).at(-1)?.replace(/[<>:"\\|*\x00-\x1f]/g, '_') || '图片.png';
  if (cached) return { data: imageData(decode(cached)), name };
  let data: string;
  if (context.attachment) data = await phoneImage(source, context);
  else if (source.startsWith('data:')) data = imageData(decode(source));
  else if (/^https:/i.test(source)) data = await remoteImage(source);
  else {
    if (/^(?![A-Za-z]:[\\/])[a-z][a-z\d+.-]*:|^\/\//i.test(source) && !source.startsWith('minis://')) throw new Error('不支持这个图片地址');
    if (context.phone) data = await phoneImage(source, context);
    else {
      if (source.startsWith('minis://')) throw new Error('手机图片需要对应的手机会话');
      const absolute = /^(\/|[A-Za-z]:[\\/])/.test(source);
      if (!absolute && !context.workspace) throw new Error('此会话没有图片工作目录');
      const path = absolute ? source : `${context.workspace}/${source}`;
      data = imageData(decode(path.includes('/.codex/generated_images/')
        ? await invoke<string>('reply_image_generated', { source: path })
        : await api<string>('POST', '/api/fs/image-base64', { path, workspace: context.workspace })));
    }
  }
  try { const request: ImageCacheWrite = { key, data }; await invoke('reply_image_store', { request }); }
  catch { warning = '图片已加载，但未保存到历史缓存；请下载保留'; }
  return { data, name: name.startsWith('data:') || name.length > 160 ? '图片.png' : name, warning };
}
export async function loadReplyImage(source: string, context: ImageContext): Promise<ReplyImage> {
  const key = await hash(new TextEncoder().encode(JSON.stringify([context, source])));
  let job = pending.get(key);
  if (!job) { job = acquire(source, context, key); pending.set(key, job); }
  try { return await job; } finally { if (pending.get(key) === job) pending.delete(key); }
}
export async function saveReplyImage(image: ReplyImage): Promise<boolean> {
  const bytes = decode(image.data), ext = image.data.slice(11, image.data.indexOf(';')).replace('jpeg', 'jpg');
  const name = /\.(png|jpe?g|webp|gif)$/i.test(image.name) ? image.name : `${image.name}.${ext}`;
  const path = await save({ defaultPath: name }); if (!path) return false;
  await invoke('local_file_save', { path, data: base64(bytes), sha256: await hash(bytes) });
  return true;
}

/** Copy pixels rather than a filesystem path or Markdown. Native clipboard works in WKWebView. */
export async function copyReplyImage(image: ReplyImage): Promise<void> {
  const bitmap = new Image(); bitmap.src = image.data; await bitmap.decode();
  const width = bitmap.naturalWidth, height = bitmap.naturalHeight;
  if (!width || !height || width * height > 16_000_000) throw new Error('图片太大，无法复制，请下载');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('无法读取图片像素');
  ctx.drawImage(bitmap, 0, 0);
  await invoke('reply_image_copy', { width, height, rgba: base64(new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer)) });
}
