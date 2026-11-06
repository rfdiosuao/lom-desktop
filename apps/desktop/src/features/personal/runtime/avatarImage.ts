import { AVATAR_SAVE_BUDGET } from './avatars';
import { PersonalStorageError } from './storageError';

export const AVATAR_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp';
export const AVATAR_SIZE = 256;
export const AVATAR_CROP_SIZE = 160;
const AVATAR_TYPES = AVATAR_ACCEPT.split(',');

/** x/y 是相对裁剪框的位移（-0.5～0.5），缩放到 256px 输出时按比例放大。 */
export type AvatarCrop = { zoom: number; x: number; y: number };
export const DEFAULT_AVATAR_CROP: AvatarCrop = { zoom: 1, x: 0, y: 0 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function avatarFileError(file: Pick<File, 'type' | 'size'>): string | undefined {
  if (!AVATAR_TYPES.includes(file.type)) return '请选择 PNG、JPG 或 WebP 图片';
  if (file.size <= 0) return '图片内容为空，请换一张重试';
  if (file.size > AVATAR_MAX_FILE_BYTES) return '图片不能超过 5 MB，请压缩后再试';
  return;
}

/** 保持图片覆盖整个方形裁剪框，并限制缩放和拖动范围，避免露出空白边。 */
export function clampAvatarCrop(crop: AvatarCrop, width: number, height: number): AvatarCrop {
  if (!(width > 0) || !(height > 0)) return { ...DEFAULT_AVATAR_CROP };
  const zoom = clamp(Number.isFinite(crop.zoom) ? crop.zoom : 1, 1, 3);
  const base = Math.max(1 / width, 1 / height);
  const maxX = Math.max(0, (width * base * zoom - 1) / 2);
  const maxY = Math.max(0, (height * base * zoom - 1) / 2);
  return {
    zoom,
    x: clamp(Number.isFinite(crop.x) ? crop.x : 0, -maxX, maxX),
    y: clamp(Number.isFinite(crop.y) ? crop.y : 0, -maxY, maxY),
  };
}

/** 和预览共用同一套几何计算，保证保存后的头像与预览一致。 */
export function drawAvatar(ctx: CanvasRenderingContext2D, image: HTMLImageElement, size: number, crop: AvatarCrop) {
  const c = clampAvatarCrop(crop, image.naturalWidth, image.naturalHeight);
  const base = Math.max(size / image.naturalWidth, size / image.naturalHeight);
  const width = image.naturalWidth * base * c.zoom, height = image.naturalHeight * base * c.zoom;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(image, (size - width) / 2 + c.x * size, (size - height) / 2 + c.y * size, width, height);
}

/** 逐步降低尺寸和质量，WebP 优先、浏览器不支持时用 JPEG；仍超出预算就如实报错，不存超限的图 */
export function renderAvatar(image: HTMLImageElement, crop: AvatarCrop): string {
  for (const size of [AVATAR_SIZE, 192, 128]) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法处理图片，请换一张重试');
    drawAvatar(ctx, image, size, crop);
    for (const quality of [0.86, 0.7, 0.55, 0.4]) for (const type of ['image/webp', 'image/jpeg']) {
      const data = canvas.toDataURL(type, quality);
      if (data.startsWith(`data:${type};`) && data.length <= AVATAR_SAVE_BUDGET) return data;
    }
  }
  throw new PersonalStorageError('personal.avatar_too_large', '图片处理后仍然过大，请换一张更简单的图片（personal.avatar_too_large）');
}

/** 旧版本留下的偏大头像：重新解码并按当前预算压缩（居中裁方，不改变画面） */
export async function recompressAvatarImage(dataUrl: string): Promise<string> {
  const image = new Image();
  image.src = dataUrl;
  try { await image.decode(); } catch { throw new Error('无法读取已保存的头像，请重新选择一张图片'); }
  return renderAvatar(image, DEFAULT_AVATAR_CROP);
}

export async function loadAvatarFile(file: File): Promise<{ image: HTMLImageElement; url: string }> {
  const error = avatarFileError(file);
  if (error) throw new Error(error);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { image, url };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('无法读取这张图片，请换一张重试');
  }
}
