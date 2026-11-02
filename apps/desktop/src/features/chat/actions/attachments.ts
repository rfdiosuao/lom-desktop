import { uploadFile } from '@/core/client';
import { personalConversation } from '@/features/personal/runtime/catalog';
import { conv } from '@/state/selectors';
import { S, update } from '@/state/store';
import type { DraftAttachment } from '@/state/types';
import { toast, toastError } from '@/shared/overlays/controller';

/* ===== 粘贴、拖入的图片和文件：先上传到 lom-core 的托管目录，发送时作为 upload 附件 ===== */

/** 单个文件上限；超过时提示改用「添加 → 文件」从本机选择（本机文件不需要上传） */
const MAX_BYTES = 20 * 1024 * 1024;

const pad = (n: number) => String(n).padStart(2, '0');

/** 截图粘贴时浏览器给的文件名通常是 image.png，换成能区分的名字 */
function nameOf(file: File, index: number) {
  const generic = !file.name || /^image\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(file.name);
  if (!generic) return file.name;
  const d = new Date();
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  return `粘贴的图片-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${index ? `-${index + 1}` : ''}.${ext}`;
}

/** 只有电脑任务（首页电脑模式、已有的 lom-core 会话）会真正上传；手机和团队仍是演示 */
function isRealDesktop(key: string) {
  if (key.startsWith('personal:')) return !!personalConversation(key)?.remote;
  if (key === 'home') return S.mode === 'desktop';
  return key.startsWith('conv:') && !!conv(key.slice(5))?.remote;
}

/** 从剪贴板或拖放数据里取出文件（剪贴板优先用 items，兼容 WebKit 只在 items 里给截图的情况） */
export function filesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromItems = Array.from(data.items || [])
    .filter(it => it.kind === 'file')
    .map(it => it.getAsFile())
    .filter((f): f is File => !!f);
  return fromItems.length ? fromItems : Array.from(data.files || []);
}

export async function attachFiles(key: string, files: File[]) {
  if (!files.length) return;
  const real = isRealDesktop(key);
  const owner = key === 'home' ? S.phoneId : key.startsWith('conv:') ? conv(key.slice(5))?.owner : undefined;
  const phone = !real && !!owner && !!S.agents[owner]?.real;
  const conversationId = key.startsWith('personal:') ? personalConversation(key)?.id : key.startsWith('conv:') ? key.slice(5) : undefined;
  for (const [i, file] of files.entries()) {
    if (file.size > (phone ? 100 * 1024 * 1024 : MAX_BYTES)) {
      toast(`「${file.name || '文件'}」超过 ${phone ? 100 : 20} MB 附件限制`, 'info');
      continue;
    }
    const image = file.type.startsWith('image/');
    const item: DraftAttachment = {
      file: phone ? file : undefined, name: nameOf(file, i), ic: image ? 'image' : 'file', kind: 'upload',
      uploading: real, preview: image ? URL.createObjectURL(file) : undefined,
    };
    update(s => { (s.attachments[key] ||= []).push(item); s.focusNext = `composer:${key}`; });
    if (!real) continue;
    try {
      const path = await uploadFile(file, item.name, conversationId);
      update(() => { item.path = path; item.uploading = false; });
    } catch (e) {
      update(s => { s.attachments[key] = (s.attachments[key] || []).filter(a => a !== item); });
      if (item.preview) URL.revokeObjectURL(item.preview);
      toastError(`「${item.name}」上传失败`, e);
    }
  }
}

export const hasUploading = (key: string) => (S.attachments[key] || []).some(a => a.uploading);
