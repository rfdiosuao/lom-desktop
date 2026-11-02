import { api } from '@/core/client';
import { authAccount, onAuthChange, type AuthGuard } from '@/features/account/runtime/authScope';
import { loadAssistants, type PersonalAssistant } from './catalog';
export const DOCUMENTS = [
  ['SOUL.md', '灵魂', '性格与表达'], ['TOOLS.md', '工具', '工具与使用约定'], ['AGENTS.md', '工作规则', '办事流程与边界'],
  ['IDENTITY.md', '身份', '名字与角色'], ['USER.md', '关于你', '已确认的偏好'], ['MEMORY.md', '长期记忆', '重要事实与决定'],
] as const;
function documentPath(a: PersonalAssistant, name: string) {
  if (!DOCUMENTS.some(d => d[0] === name) && !/^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(name)) throw new Error('不允许的文档路径');
  return `${a.directory}/${name}`;
}
export async function readDocument(a: PersonalAssistant, name: string) {
  if (!loadAssistants().items.some(x => x.id === a.id && x.directory === a.directory)) return Promise.reject(new Error('账号已切换，无法读取这位助理的文档'));
  const current = authAccount();
  const text = await api<string>('POST', '/api/fs/read', { path: documentPath(a, name), workspace: a.directory });
  if (!current()) throw new Error('账号已切换');
  return text;
}
export async function saveDocument(a: PersonalAssistant, name: string, before: string, value: string) {
  if (value.length > 64000) throw new Error('文档过长，请拆成较短的记忆');
  const owner = authAccount();
  const current = await readDocument(a, name);
  if (!owner()) throw new Error('账号已切换，未保存');
  if (current !== before) throw new Error('文档已被修改，请重新读取后再保存');
  await api('POST', '/api/fs/write', { path: documentPath(a, name), data: value, workspace: a.directory });
  if (!owner()) throw new Error('账号已切换，保存结果待核对');
}
export async function listDiary(a: PersonalAssistant) {
  if (!loadAssistants().items.some(x => x.id === a.id && x.directory === a.directory)) throw new Error('账号已切换，无法读取日记');
  const current = authAccount();
  const rows = await api<{ name: string; is_dir: boolean }[]>('POST', '/api/fs/dir', { dir: `${a.directory}/memory`, root: a.directory });
  if (!current()) throw new Error('账号已切换');
  return rows.filter(x => !x.is_dir && /^\d{4}-\d{2}-\d{2}\.md$/.test(x.name)).map(x => `memory/${x.name}`).sort().reverse();
}

type DocumentDraft = { base: string; value: string };
const cache = new Map<string, { draft: DocumentDraft; current: AuthGuard }>();
onAuthChange(() => cache.clear());
export const documentDrafts = {
  get(key: string) { for (const [id, item] of cache) if (!item.current()) cache.delete(id); return cache.get(key)?.draft; },
  set(key: string, draft: DocumentDraft) { cache.set(key, { draft, current: authAccount() }); },
  delete(key: string) { cache.delete(key); },
};
