import { MAX_AVATAR_DATA_URL } from './avatars';

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

export function renderAvatar(image: HTMLImageElement, crop: AvatarCrop): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法处理图片，请换一张重试');
  drawAvatar(ctx, image, AVATAR_SIZE, crop);
  for (const quality of [0.86, 0.7, 0.55]) {
    const data = canvas.toDataURL('image/jpeg', quality);
    if (data.length <= MAX_AVATAR_DATA_URL) return data;
  }
  throw new Error('图片处理后仍然过大，请换一张更简单的图片');
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
