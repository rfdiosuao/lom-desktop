import { S } from '@/state/store';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { phoneRpc } from './phoneRpc';
import type { PhoneControl, ScreenFrame, ScreenRequest } from '@/core/remoteWire';
export const screenError = (e: unknown) => {
  const text = e instanceof Error ? e.message : String(e);
  if (text.includes('screen.permission_required')) return '请在手机系统设置中开启 Lom 的无障碍服务，再重试。';
  if (text.includes('remote.method_unknown')) return '手机版本尚未支持画面，请安装新版 APK 后重试。';
  if (text.includes('screen.unsupported')) return '真实画面需要 Android 11 或更新版本。';
  if (text.includes('screen.frame_too_large')) return '画面过大，请改用流畅画质后重试。';
  if (text.includes('screen.capture_failed')) return '当前画面无法获取。请解锁手机；受保护的窗口可能禁止截图。';
  return text;
};
export async function capturePhone(device: string, quality = S.quality): Promise<ScreenFrame> {
  const request: ScreenRequest = { quality: quality === '高清' ? 'high' : quality === '流畅' ? 'low' : 'balanced', cellular_cap: S.prefs.cellularCap ? 'true' : 'false' };
  const frame = await phoneRpc<ScreenFrame>(device, 'screen.capture', request);
  if (frame.mime !== 'image/jpeg' || !frame.image || frame.image.length > 800000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(frame.image) || ![frame.width, frame.height, frame.captured_at].every(x => Number.isFinite(Number(x)) && Number(x) > 0)) throw new Error('手机返回了无效画面');
  return frame;
}
export async function saveScreen(frame: ScreenFrame) {
  const path = await save({ defaultPath: `手机截图-${frame.captured_at}.jpg` });
  if (!path) return false;
  const bytes = Uint8Array.from(atob(frame.image), c => c.charCodeAt(0));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  await invoke('local_file_save', { path, data: frame.image, sha256: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('') });
  return true;
}
export async function controlPhone(device: string, args: Record<string, unknown>, requestId: string = crypto.randomUUID()) {
  const p: PhoneControl = { request_id: requestId, action: String(args.action || ''), x: String(args.x ?? ''), y: String(args.y ?? ''),
    x2: String(args.x2 ?? ''), y2: String(args.y2 ?? ''), text: String(args.text ?? ''), package_name: String(args.package_name ?? '') };
  return phoneRpc(device, 'screen.control', p);
}
