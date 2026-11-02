import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { phoneRpc } from './phoneRpc';
import type { FileBegin, FileChunk, FileState, FileData, FileList, ChatFile, FileGalleryRequest, FileGalleryResult } from '@/core/remoteWire';
import type { DraftAttachment } from '@/state/types';
import { update } from '@/state/store';
const MAX = 100 * 1024 * 1024;
const CHUNK = 128 * 1024;
export function base64(bytes: Uint8Array): string {
  let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
const mimeOf = (name: string) => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', md: 'text/markdown', txt: 'text/plain', pdf: 'application/pdf', mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg' }[name.split('.').pop()?.toLowerCase() || ''] || 'application/octet-stream');
async function info(a: DraftAttachment): Promise<[string, string]> {
  if (a.file) {
    if (a.file.size > MAX) throw new Error('单个手机附件最大 100 MB');
    const bytes = await a.file.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return [String(bytes.byteLength), Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, '0')).join('')];
  }
  if (!a.path) throw new Error('附件内容已失效，请重新选择文件');
  return invoke<[string, string]>('local_file_info', { path: a.path });
}
export async function uploadPhoneFile(device: string, a: DraftAttachment, current: () => void = () => {}): Promise<string> {
  if (a.uploading) throw new Error('附件正在传输');
  update(() => { a.uploading = true; });
  try {
    current();
    const [size, sha256] = await info(a);
    current();
    if (!a.transferId || a.transferDevice !== device) { a.transferId = crypto.randomUUID(); a.transferDevice = device; }
    const id = a.transferId;
    const begin: FileBegin = { id, name: a.name, size, sha256, mime: a.file?.type || mimeOf(a.name) };
    let state = await phoneRpc<FileState>(device, 'file.begin', begin);
    current();
    if (!Number.isSafeInteger(Number(state.offset)) || Number(state.offset) < 0 || Number(state.offset) > Number(size)) throw new Error('手机返回了无效传输进度');
    while (Number(state.offset) < Number(size)) {
      const offset = Number(state.offset);
      const data = a.file ? base64(new Uint8Array(await a.file.slice(offset, offset + CHUNK).arrayBuffer()))
        : await invoke<string>('local_file_chunk', { path: a.path, offset });
      current();
      const chunk: FileChunk = { id, offset: String(offset), data };
      state = await phoneRpc<FileState>(device, 'file.chunk', chunk);
      current();
      if (Number(state.offset) <= offset || Number(state.offset) > Number(size)) throw new Error('手机返回了无效传输进度');
      update(() => { a.progress = Math.round(Number(state.offset) * 100 / Number(size)); });
    }
    current();
    state = await phoneRpc<FileState>(device, 'file.finish', { id });
    current();
    if (state.id !== id || state.status !== 'complete' || state.sha256 !== sha256) throw new Error('手机尚未确认文件完整');
    return id;
  } finally { update(() => { a.uploading = false; }); }
}
export async function listPhoneFiles(device: string): Promise<FileState[]> {
  const result = await phoneRpc<FileList>(device, 'file.list', {});
  return JSON.parse(result.items);
}
export async function downloadPhoneFile(device: string, file: FileState) {
  const path = await save({ defaultPath: file.name });
  if (!path) return false;
  const size = Number(file.size);
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX) throw new Error('文件大小超出限制');
  const bytes = new Uint8Array(size);
  let offset = 0;
  while (offset < size) {
    const chunk = await phoneRpc<FileData>(device, 'file.read', { id: file.id, offset: String(offset) });
    const data = Uint8Array.from(atob(chunk.data), c => c.charCodeAt(0));
    if (!data.length || offset + data.length > size || Number(chunk.next) !== offset + data.length) throw new Error('手机返回了无效文件分片');
    bytes.set(data, offset); offset += data.length;
  }
  await invoke('local_file_save', { path, data: base64(bytes), sha256: file.sha256 });
  return true;
}
export async function deletePhoneFile(device: string, id: string) { await phoneRpc(device, 'file.delete', { id }); }

export async function downloadChatAttachment(ref: { device: string; session: string; message: string; index: number }) {
  const request: ChatFile = { session_id: ref.session, message_id: ref.message, index: String(ref.index) };
  const file = await phoneRpc<FileState>(ref.device, 'chat.file', request);
  return downloadPhoneFile(ref.device, file);
}

export async function savePhoneGallery(device: string, id: string) {
  const request: FileGalleryRequest = { id };
  const result = await phoneRpc<FileGalleryResult>(device, 'file.save_gallery', request);
  if (result.status !== 'saved' || result.id !== id || !result.uri.startsWith('content://media/')) throw new Error('手机尚未确认保存到相册');
  return result;
}
