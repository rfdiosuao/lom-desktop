/** PA-AVATAR-02：个人助理本机配置保存失败的具体原因。错误码写进用户可见的提示，方便反馈和排查。 */
export type PersonalStorageCode = 'personal.storage_full' | 'personal.storage_unavailable' | 'personal.avatar_too_large';

export class PersonalStorageError extends Error {
  constructor(readonly code: PersonalStorageCode, message: string) { super(message); this.name = 'PersonalStorageError'; }
}
