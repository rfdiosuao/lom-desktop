export const AVATARS = [
  { id: '01', name: '绒绒小麓' }, { id: '02', name: '薄荷小麓' }, { id: '03', name: '叶影小麓' },
  { id: '04', name: '琉璃小麓' }, { id: '05', name: '暖绒小麓' }, { id: '06', name: '团子小麓' },
] as const;
export type AvatarId = typeof AVATARS[number]['id'];
export const DEFAULT_AVATAR: AvatarId = '06';
export const isAvatar = (id?: string): id is AvatarId => AVATARS.some(a => a.id === id);
export const avatarUrl = (id?: string) => `/mascots/deer-${id && isAvatar(id) ? id : DEFAULT_AVATAR}.png`;

/** 自定义头像只保存处理后的 256px 小图，避免把原图写进本机存储和模型上下文。 */
export const MAX_AVATAR_DATA_URL = 300_000;
const CUSTOM_AVATAR_PREFIX = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
export type AvatarLike = { avatar?: string; avatarImage?: string };
export const isAvatarImage = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_AVATAR_DATA_URL && CUSTOM_AVATAR_PREFIX.test(value);
/** 展示时优先自定义图片；缺失、损坏或旧配置回退到预设形象。 */
export const customAvatar = (value: AvatarLike) => (isAvatarImage(value.avatarImage) ? value.avatarImage : undefined);
