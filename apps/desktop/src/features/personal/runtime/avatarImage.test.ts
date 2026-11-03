import { expect, it, vi } from 'vitest';
import { AVATAR_MAX_FILE_BYTES, avatarFileError, clampAvatarCrop, drawAvatar } from './avatarImage';

it('PA-AVATAR-01 limits uploads to PNG, JPG or WebP and five megabytes', () => {
  const file = (type: string, size: number) => ({ type, size });
  expect(avatarFileError(file('image/png', 1024))).toBeUndefined();
  expect(avatarFileError(file('image/svg+xml', 1024))).toContain('PNG');
  expect(avatarFileError(file('image/jpeg', 0))).toContain('空');
  expect(avatarFileError(file('image/webp', AVATAR_MAX_FILE_BYTES + 1))).toContain('5 MB');
});

it('PA-AVATAR-01 keeps the crop covering the square and clamps zoom and pan', () => {
  expect(clampAvatarCrop({ zoom: 0.2, x: 9, y: 9 }, 400, 200)).toEqual({ zoom: 1, x: 0.5, y: 0 });
  expect(clampAvatarCrop({ zoom: 9, x: -9, y: -9 }, 200, 400)).toEqual({ zoom: 3, x: -1, y: -2.5 });
  expect(clampAvatarCrop({ zoom: Number.NaN, x: Number.NaN, y: Number.NaN }, 300, 300)).toEqual({ zoom: 1, x: 0, y: 0 });
  expect(clampAvatarCrop({ zoom: 2, x: 0, y: 0 }, 300, 300)).toEqual({ zoom: 2, x: 0, y: 0 });
});

it('PA-AVATAR-01 draws the same square geometry used by the preview and the saved image', () => {
  const image = { naturalWidth: 400, naturalHeight: 200 } as HTMLImageElement;
  const ctx = { clearRect: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' } as unknown as CanvasRenderingContext2D;
  drawAvatar(ctx, image, 256, { zoom: 2, x: 0, y: 0 });
  expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 256, 256);
  expect(ctx.drawImage).toHaveBeenCalledWith(image, -384, -128, 1024, 512);
});
