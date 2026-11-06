import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { AVATAR_SAVE_BUDGET } from './avatars';
import { renderAvatar, DEFAULT_AVATAR_CROP } from './avatarImage';
import { compactStoredAvatars } from './avatarStore';
import { addAssistant, loadAssistants, updateAssistantAvatar } from './catalog';
import { avatarSaveError, personalError } from './errors';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => '/assistant') }));

const image = (n: number) => `data:image/jpeg;base64,${'A'.repeat(n - 23)}`;
const SMALL = image(2_000), LEGACY = image(250_000);
const failWrites = (error: () => unknown) => {
  const setItem = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (key === 'lom.personal.v1:a') throw error();
    return setItem.call(this, key, value);
  });
};
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); S.cloud = 'signed-in'; S.account = { id: 'a', name: '', email: '' }; S.convs = []; });
afterEach(() => vi.restoreAllMocks());

const fakeCanvas = (encode: (type: string, quality: number, size: number) => string) => {
  let size = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect() {}, fillRect() {}, drawImage() {}, fillStyle: '' } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement, type?: string, quality?: number) { size = this.width; return encode(type ?? '', quality ?? 1, size); });
};
const photo = { naturalWidth: 4000, naturalHeight: 3000 } as HTMLImageElement;

it('PA-AVATAR-02 a large photo is compressed under the save budget by lowering quality and size', () => {
  // 只有 128px 且质量足够低时才进预算：证明会逐级降级而不是直接放弃
  fakeCanvas((type, quality, size) => `data:${type};base64,${'A'.repeat(size === 128 && quality <= 0.55 ? 90_000 : 400_000)}`);
  const out = renderAvatar(photo, DEFAULT_AVATAR_CROP);
  expect(out.length).toBeLessThanOrEqual(AVATAR_SAVE_BUDGET);
  expect(out.startsWith('data:image/webp;')).toBe(true);
});

it('PA-AVATAR-02 falls back to JPEG when the browser cannot encode WebP', () => {
  fakeCanvas((type) => (type === 'image/webp' ? `data:image/png;base64,${'A'.repeat(1_000)}` : `data:image/jpeg;base64,${'A'.repeat(50_000)}`));
  expect(renderAvatar(photo, DEFAULT_AVATAR_CROP).startsWith('data:image/jpeg;')).toBe(true);
});

it('PA-AVATAR-02 an image that never fits reports personal.avatar_too_large instead of saving it', () => {
  fakeCanvas((type) => `data:${type};base64,${'A'.repeat(900_000)}`);
  expect(() => renderAvatar(photo, DEFAULT_AVATAR_CROP)).toThrow('personal.avatar_too_large');
});

it('PA-AVATAR-02 an over-budget avatar is refused before touching storage', async () => {
  const a = await addAssistant('小麓', '02', SMALL);
  const spy = vi.spyOn(Storage.prototype, 'setItem');
  let error: unknown;
  try { updateAssistantAvatar(a.id, { avatar: '03', avatarImage: image(AVATAR_SAVE_BUDGET + 100) }); } catch (e) { error = e; }
  expect(avatarSaveError(error)).toBe('更换头像失败：头像图片过大，请换一张更简单的图片。原头像保持不变。（personal.avatar_too_large）');
  expect(spy).not.toHaveBeenCalled();
  expect(loadAssistants().items[0]).toMatchObject({ avatar: '02', avatarImage: SMALL });
});

it('PA-AVATAR-02 a full storage is reported as changing the avatar failed, with its code, and nothing is half-saved', async () => {
  const a = await addAssistant('小麓', '02', SMALL), b = await addAssistant('工作助理', '03');
  const spy = failWrites(() => new DOMException('full', 'QuotaExceededError'));
  let error: unknown;
  try { updateAssistantAvatar(a.id, { avatar: '05', avatarImage: SMALL }); } catch (e) { error = e; }
  spy.mockRestore();
  expect(avatarSaveError(error)).toBe('更换头像失败：本机存储已满，请清理本机存储空间后重试。原头像保持不变。（personal.storage_full）');
  expect(avatarSaveError(error)).not.toContain('创建');
  const saved = loadAssistants().items;
  expect(saved.find(x => x.id === a.id)).toMatchObject({ avatar: '02', avatarImage: SMALL });
  expect(saved.find(x => x.id === b.id)).toMatchObject({ name: '工作助理', avatar: '03' });
});

it('PA-AVATAR-02 disabled storage is told apart from a full one', async () => {
  const a = await addAssistant('小麓', '02');
  const spy = failWrites(() => new DOMException('denied', 'SecurityError'));
  let error: unknown;
  try { updateAssistantAvatar(a.id, { avatar: '05' }); } catch (e) { error = e; }
  spy.mockRestore();
  expect(avatarSaveError(error)).toContain('被禁用或不可用');
  expect(avatarSaveError(error)).toContain('personal.storage_unavailable');
  expect(personalError(error)).toContain('personal.storage_unavailable');
});

it('PA-AVATAR-02 legacy oversized avatars are still readable and are compressed on the next save without touching others', async () => {
  await addAssistant('小麓', '02'); await addAssistant('工作助理', '03', SMALL);
  const raw = JSON.parse(localStorage.getItem('lom.personal.v1:a')!);
  raw.items[0].avatarImage = LEGACY; raw.items[0].conversation = 'conv-a';
  localStorage.setItem('lom.personal.v1:a', JSON.stringify(raw));
  expect(loadAssistants().items[0].avatarImage).toBe(LEGACY);
  const before = localStorage.getItem('lom.personal.v1:a')!.length;
  const recompress = vi.fn(async () => SMALL);
  expect(await compactStoredAvatars('a', recompress)).toBe(true);
  expect(recompress).toHaveBeenCalledTimes(1);
  const items = loadAssistants().items;
  expect(items[0]).toMatchObject({ name: '小麓', conversation: 'conv-a', avatarImage: SMALL });
  expect(items[1]).toMatchObject({ name: '工作助理', avatarImage: SMALL });
  expect(localStorage.getItem('lom.personal.v1:a')!.length).toBeLessThan(before);
});

it('PA-AVATAR-02 one avatar that cannot be recompressed is left as it was and does not block the others', async () => {
  await addAssistant('甲', '02'); await addAssistant('乙', '03');
  const raw = JSON.parse(localStorage.getItem('lom.personal.v1:a')!);
  raw.items[0].avatarImage = LEGACY; raw.items[1].avatarImage = image(260_000);
  localStorage.setItem('lom.personal.v1:a', JSON.stringify(raw));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const recompress = vi.fn(async (d: string) => { if (d === LEGACY) throw new Error('坏图'); return SMALL; });
  await compactStoredAvatars('a', recompress);
  const items = loadAssistants().items;
  expect(items[0].avatarImage).toBe(LEGACY);
  expect(items[1].avatarImage).toBe(SMALL);
  expect(warn).toHaveBeenCalledWith('personal.avatar_compact_failed', '坏图');
});
