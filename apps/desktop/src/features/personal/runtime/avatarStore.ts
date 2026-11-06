import { AVATAR_SAVE_BUDGET } from './avatars';
import { recompressAvatarImage } from './avatarImage';
import { applyCompactedAvatars, accountId, loadAssistants } from './catalog';

type Recompress = (dataUrl: string) => Promise<string>;

/** 超出保存预算的头像（旧版本留下的）压缩后再保存；预算内原样返回（PA-AVATAR-02） */
export async function compactAvatarImage(image: string | undefined, recompress: Recompress = recompressAvatarImage) {
  return image && image.length > AVATAR_SAVE_BUDGET ? recompress(image) : image;
}

/** 旧用户本机已存的偏大头像：逐个压缩后一次写回，腾出空间。某一张压缩失败只记日志，不影响其他助理和这次操作。 */
export async function compactStoredAvatars(account = accountId(), recompress: Recompress = recompressAvatarImage) {
  const changes = new Map<string, { from: string; to: string }>();
  for (const item of loadAssistants(account).items) {
    const from = item.avatarImage;
    if (!from || from.length <= AVATAR_SAVE_BUDGET) continue;
    try { changes.set(item.id, { from, to: await recompress(from) }); }
    catch (e) { console.warn('personal.avatar_compact_failed', e instanceof Error ? e.message : e); }
  }
  return changes.size > 0 && applyCompactedAvatars(changes, account);
}
