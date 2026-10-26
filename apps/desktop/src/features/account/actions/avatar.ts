import { S, update } from '@/state/store';

/** 只在用户选图后读取文件；缩放成 256px JPEG，避免上传原图和元数据。 */
export async function chooseAvatar(file?: File) {
  if (!file) return;
  const f = S.form;
  update(() => { f.error = ''; f.reading = true; });
  let url = '';
  try {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('请选择 5 MB 以内的 JPG、PNG 或 WebP 图片');
    url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法处理图片，请换一张重试');
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 256, 256);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    update(() => { if (S.form === f) f.avatar = canvas.toDataURL('image/jpeg', 0.85); });
  } catch (e) {
    update(() => { f.error = e instanceof Error ? e.message : String(e); });
  } finally {
    if (url) URL.revokeObjectURL(url);
    update(() => { f.reading = false; });
  }
}
