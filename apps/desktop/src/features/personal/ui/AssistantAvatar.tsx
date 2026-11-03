import { useState } from 'react';
import { avatarUrl, customAvatar, DEFAULT_AVATAR, type AvatarLike } from '../runtime/avatars';

/** 同一助理在标签、会话头、消息等处共用：自定义图加载失败时依次回退预设和默认形象。 */
export function AssistantAvatar({ assistant, className, alt = '' }: { assistant: AvatarLike; className?: string; alt?: string }) {
  const custom = customAvatar(assistant);
  const preset = avatarUrl(assistant.avatar), fallback = avatarUrl(DEFAULT_AVATAR);
  const [failed, setFailed] = useState<string[]>([]);
  const src = (custom ? [custom, preset, fallback] : [preset, fallback]).find(url => !failed.includes(url)) ?? fallback;
  const onError = src === fallback ? undefined : () => setFailed(list => (list.includes(src) ? list : [...list, src]));
  return <img src={src} alt={alt} className={className} data-avatar={custom && src === custom ? 'custom' : 'preset'} onError={onError} />;
}
