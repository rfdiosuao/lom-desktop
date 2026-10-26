import { cloud } from './cloud';
import { S, update } from '@/state/store';

/* ===== 意见反馈（A04 §2.2）：提交（可附 3 张截图）、查看站长回复、追问 =====
 * 截图在服务端重新处理并去掉元数据；诊断信息只有 App 版本和系统版本，不含对话内容和文件。 */

export interface FeedbackThread {
  id: string; status: 'open' | 'replied' | 'closed'; unread: boolean; created_at: number; updated_at: number;
  messages: { author: 'user' | 'admin'; text: string; at: number }[];
}

export const APP_VERSION = '0.1.0';
const MAX_IMAGE = 5 * 1024 * 1024;

export function osName() {
  const ua = navigator.userAgent;
  const mac = ua.match(/Mac OS X (\d+[._]\d+)/);
  if (mac) return `macOS ${mac[1].replace('_', '.')}`;
  const win = ua.match(/Windows NT ([\d.]+)/);
  return win ? `Windows ${win[1]}` : navigator.platform || '';
}

async function base64(file: Blob) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** 截图校验：只收 PNG / JPEG，单张 5 MB 以内（与服务端一致） */
export function checkShot(file: File) {
  if (!['image/png', 'image/jpeg'].includes(file.type)) return '截图只支持 PNG / JPEG';
  if (file.size > MAX_IMAGE) return '单张截图不能超过 5 MB';
  return '';
}

export async function submitFeedback(text: string, shots: File[], diagnostics: boolean) {
  const t = text.trim();
  if (t.length < 5) throw new Error('请至少写 5 个字');
  if (shots.length > 3) throw new Error('最多附 3 张截图');
  const images = await Promise.all(shots.map(base64));
  const r = await cloud<{ id: string }>('POST', '/v1/feedback', { text: t, images, ...(diagnostics ? { app_version: APP_VERSION, os: osName() } : {}) });
  await loadFeedback();
  return r.id;
}

export async function loadFeedback() {
  if (S.cloud !== 'signed-in') return;
  try {
    const list = await cloud<FeedbackThread[]>('GET', '/v1/feedback');
    update(s => { s.feedback = list; });
  } catch (e) {
    console.warn('feedback.load_failed', e instanceof Error ? e.message : e);
  }
}

/** 打开一条有新回复的反馈时标记已读，设置图标上的小红点随之消失 */
export async function readFeedback(id: string) {
  const f = S.feedback.find(x => x.id === id);
  if (!f?.unread) return;
  update(() => { f.unread = false; });
  try { await cloud('POST', `/v1/feedback/${encodeURIComponent(id)}/read`, {}); }
  catch (e) { update(() => { f.unread = true; }); throw e; }
}

export async function followUp(id: string, text: string) {
  if (!text.trim()) throw new Error('先写点内容');
  await cloud('POST', `/v1/feedback/${encodeURIComponent(id)}/messages`, { text: text.trim() });
  await loadFeedback();
}

export const unreadFeedback = () => S.feedback.filter(f => f.unread).length;
