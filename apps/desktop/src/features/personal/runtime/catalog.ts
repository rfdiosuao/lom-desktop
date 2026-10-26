import type { PermissionTier } from './permissions';
import { DEFAULT_AVATAR, isAvatar, type AvatarId } from './avatars';
import { authAccount } from '@/features/account/runtime/authScope';
import { invoke } from '@tauri-apps/api/core';
import { S } from '@/state/store';
export interface PersonalAssistant { avatar?: AvatarId; id: string; name: string; directory: string; workspace: string; conversation?: string; pendingCreate?: boolean; permission?: PermissionTier; permissionPending?: PermissionTier; permissionMigrated?: boolean; permissionError?: string }
interface Catalog { items: PersonalAssistant[]; selected?: string }
const key = (account: string) => `lom.personal.v1:${account}`;
export const accountId = () => { if (!S.account?.id || S.cloud !== 'signed-in') throw new Error('请先登录账号'); return S.account.id; };
export function loadAssistants(account = accountId()): Catalog {
  // 读取本身失败（存储被禁用）要保留原生异常，交给错误分类提示本机存储问题；只有内容无法解析才算配置损坏。
  const stored = localStorage.getItem(key(account)) || '{"items":[]}';
  let raw: Catalog;
  try { raw = JSON.parse(stored) as Catalog; } catch { throw new Error('助理配置损坏，请先恢复备份'); }
  if (!raw || !Array.isArray(raw.items) || raw.items.some(x => !/^[a-z0-9_-]{1,80}$/.test(x.id) || typeof x.name !== 'string' || typeof x.directory !== 'string' || typeof x.workspace !== 'string')) throw new Error('助理配置损坏，请先恢复备份');
  return raw;
}
export function storeAssistant(a: PersonalAssistant, account = accountId()) {
  const data = loadAssistants(account);
  const index = data.items.findIndex(x => x.id === a.id);
  if (index < 0) data.items.push(a); else data.items[index] = a;
  data.selected = a.id;
  localStorage.setItem(key(account), JSON.stringify(data));
}
/** PA-DELETE：从本机目录里移除这位助理（会话、定时任务、飞书绑定由 deleteAssistant 先处理） */
export function removeAssistant(id: string, account = accountId()) {
  const data = loadAssistants(account);
  data.items = data.items.filter(x => x.id !== id);
  if (data.selected === id) data.selected = data.items[0]?.id;
  localStorage.setItem(key(account), JSON.stringify(data));
}
export async function addAssistant(name: string, avatar: AvatarId = DEFAULT_AVATAR) {
  const account = accountId(), current = authAccount();
  if (!isAvatar(avatar)) throw new Error('请选择有效的助理形象');
  if (!name.trim() || name.trim().length > 40) throw new Error('助理名称须为1至40个字符');
  const id = `pa_${crypto.randomUUID()}`;
  const directory = await invoke<string>('personal_directory', { account, id, name: name.trim() });
  if (!current()) throw new Error('账号已切换，请重新打开助理');
  const a: PersonalAssistant = { id, name: name.trim(), directory, workspace: directory, avatar, permission: 'routine', permissionMigrated: true };
  storeAssistant(a, account); return a;
}

export function personalConversation(key: string) {
  if (!key.startsWith('personal:') || S.cloud !== 'signed-in' || !S.account) return;
  try { const a = loadAssistants().items.find(x => x.id === key.slice(9)); return a?.conversation ? S.convs.find(c => c.id === a.conversation && c.personal?.id === a.id) : undefined; }
  catch { return; }
}
