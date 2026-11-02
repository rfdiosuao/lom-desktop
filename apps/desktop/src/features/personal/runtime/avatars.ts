export const AVATARS = [
  { id: '01', name: '绒绒小麓' }, { id: '02', name: '薄荷小麓' }, { id: '03', name: '叶影小麓' },
  { id: '04', name: '琉璃小麓' }, { id: '05', name: '暖绒小麓' }, { id: '06', name: '团子小麓' },
] as const;
export type AvatarId = typeof AVATARS[number]['id'];
export const DEFAULT_AVATAR: AvatarId = '06';
export const isAvatar = (id: string): id is AvatarId => AVATARS.some(a => a.id === id);
export const avatarUrl = (id?: string) => `/mascots/deer-${id && isAvatar(id) ? id : DEFAULT_AVATAR}.png`;
