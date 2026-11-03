import type { PermissionTier } from './permissions';
import { DEFAULT_AVATAR, isAvatar, isAvatarImage, type AvatarId } from './avatars';
import { authAccount } from '@/features/account/runtime/authScope';
import { invoke } from '@tauri-apps/api/core';
import { S, update } from '@/state/store';
import { cacheWriteError, writeJson } from '@/features/account/runtime/localCache';
export interface PersonalAssistant { mcpRefreshPending?: boolean; avatar?: AvatarId; avatarImage?: string; id: string; name: string; directory: string; workspace: string; conversation?: string; pendingCreate?: boolean; permission?: PermissionTier; permissionPending?: PermissionTier; permissionMigrated?: boolean; permissionError?: string }
interface Catalog { items: PersonalAssistant[]; selected?: string }
const key = (account: string) => `lom.personal.v1:${account}`;
export const accountId = () => { if (!S.account?.id || S.cloud !== 'signed-in') throw new Error('请先登录账号'); return S.account.id; };
/** 助理名称规则：新建弹窗内校验与创建时校验共用 */
export const assistantNameError = (name: string) => (!name.trim() || name.trim().length > 40 ? '助理名称须为1至40个字符' : undefined);
export function loadAssistants(account = accountId()): Catalog {
  // 读取本身失败（存储被禁用）要保留原生异常，交给错误分类提示本机存储问题；只有内容无法解析才算配置损坏。
  const stored = localStorage.getItem(key(account)) || '{"items":[]}';
  let raw: Catalog;
  try { raw = JSON.parse(stored) as Catalog; } catch { throw new Error('助理配置损坏，请先恢复备份'); }
  if (!raw || !Array.isArray(raw.items) || raw.items.some(x => !/^[a-z0-9_-]{1,80}$/.test(x.id) || typeof x.name !== 'string' || typeof x.directory !== 'string' || typeof x.workspace !== 'string')) throw new Error('助理配置损坏，请先恢复备份');
  // 自定义头像损坏或被外部改坏时只丢弃这张图，保留助理和原预设形象。
  for (const item of raw.items) if (item.avatarImage !== undefined && !isAvatarImage(item.avatarImage)) delete item.avatarImage;
  return raw;
}
/** 写满或存储不可用时明确报错，不让调用方以为已保存（REFACTOR-01 模块 7） */
function saveCatalog(account: string, data: Catalog) {
  const result = writeJson(key(account), data);
  if (result !== 'ok') throw new Error(`${cacheWriteError(result)}，助理配置未保存`);
}
export function storeAssistant(a: PersonalAssistant, account = accountId()) {
  const data = loadAssistants(account);
  const index = data.items.findIndex(x => x.id === a.id);
  if (index < 0) data.items.push(a); else data.items[index] = a;
  data.selected = a.id;
  saveCatalog(account, data);
}
/** PA-DELETE：从本机目录里移除这位助理（会话、定时任务、飞书绑定由 deleteAssistant 先处理） */
export function removeAssistant(id: string, account = accountId()) {
  const data = loadAssistants(account);
  data.items = data.items.filter(x => x.id !== id);
  if (data.selected === id) data.selected = data.items[0]?.id;
  saveCatalog(account, data);
}
export async function addAssistant(name: string, avatar: AvatarId = DEFAULT_AVATAR, avatarImage?: string) {
  const account = accountId(), current = authAccount();
  if (!isAvatar(avatar)) throw new Error('请选择有效的助理形象');
  if (avatarImage !== undefined && !isAvatarImage(avatarImage)) throw new Error('请选择有效的头像图片');
  const invalid = assistantNameError(name); if (invalid) throw new Error(invalid);
  const id = `pa_${crypto.randomUUID()}`;
  const directory = await invoke<string>('personal_directory', { account, id, name: name.trim() });
  if (!current()) throw new Error('账号已切换，请重新打开助理');
  const a: PersonalAssistant = { id, name: name.trim(), directory, workspace: directory, avatar, ...(avatarImage ? { avatarImage } : {}), permission: 'routine', permissionMigrated: true };
  storeAssistant(a, account); return a;
}

/** PA-AVATAR-01：只改头像字段，不碰会话、人格、记忆、模型、权限或绑定账号，也不改变当前选中的助理。 */
export function updateAssistantAvatar(id: string, choice: { avatar: AvatarId; avatarImage?: string }, account = accountId()) {
  if (accountId() !== account) throw new Error('账号已切换，头像未保存');
  if (!isAvatar(choice.avatar)) throw new Error('请选择有效的助理形象');
  if (choice.avatarImage !== undefined && !isAvatarImage(choice.avatarImage)) throw new Error('请选择有效的头像图片');
  const data = loadAssistants(account), item = data.items.find(x => x.id === id);
  if (!item) throw new Error('助理不存在，请重新打开助理');
  item.avatar = choice.avatar;
  if (choice.avatarImage) item.avatarImage = choice.avatarImage; else delete item.avatarImage;
  saveCatalog(account, data);
  return item;
}

/** 保存成功后同步本机已加载会话里的头像，保证聊天头和消息头像立即一致；不动会话内容。 */
export function syncAssistantAvatar(assistant: PersonalAssistant, account = accountId()) {
  if (S.account?.id !== account) return false;
  update(s => {
    for (const c of s.convs) if (c.personal?.id === assistant.id) {
      c.personal.avatar = assistant.avatar;
      if (assistant.avatarImage) c.personal.image = assistant.avatarImage; else delete c.personal.image;
    }
  });
  return true;
}

export function personalConversation(key: string) {
  if (!key.startsWith('personal:') || S.cloud !== 'signed-in' || !S.account) return;
  try { const a = loadAssistants().items.find(x => x.id === key.slice(9)); return a?.conversation ? S.convs.find(c => c.id === a.conversation && c.personal?.id === a.id) : undefined; }
  catch { return; }
}
