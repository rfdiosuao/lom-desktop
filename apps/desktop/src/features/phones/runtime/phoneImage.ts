import { invoke } from '@tauri-apps/api/core';
import { savePhoneGallery, uploadPhoneFile } from './phoneFiles';

/** Receipt is for a file on the phone, never publication to an app or a completed phone task. */
export async function sendPhoneImage(device: string, args: Record<string, unknown>, current: () => void) {
  const path = typeof args.file_path === 'string' ? args.file_path : '';
  if (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path)) throw new Error('图片必须使用本机绝对路径');
  if (args.save_to_gallery !== undefined && typeof args.save_to_gallery !== 'boolean') throw new Error('save_to_gallery 必须是布尔值');
  current();
  const image = await invoke<string>('local_image_data', { path });
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image);
  if (!match) throw new Error('图片快照格式无效');
  const mime = match[1];
  const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
  current();
  const name = path.split(/[\\/]/).pop() || 'image';
  const file = new File([bytes], name, { type: mime });
  const id = await uploadPhoneFile(device, { file, name }, current);
  current();
  const receipt = { status: 'received', file_id: id, name, mime };
  if (!args.save_to_gallery) return receipt;
  try {
    current();
    const saved = await savePhoneGallery(device, id);
    current();
    return { ...receipt, status: 'saved_to_gallery', uri: saved.uri };
  } catch (error) {
    current();
    return { ...receipt, gallery_error: error instanceof Error ? error.message : String(error) };
  }
}
