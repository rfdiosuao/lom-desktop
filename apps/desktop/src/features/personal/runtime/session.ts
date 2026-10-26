import { applyPersonalPermission } from './permissions';
import { personalRules } from './identity';
import { conversationSkills } from '@/features/skills/runtime/conversationSkills';
import { EXCLUDED_AUTO_SKILLS } from '@/features/settings/runtime/agentRules';
import { authAccount, type AuthGuard } from '@/features/account/runtime/authScope';
import { invoke } from '@tauri-apps/api/core';
import { api, CoreError } from '@/core/client';
import type { CoreConversation } from '@/core/types';
import { convFromCore } from '@/features/chat/runtime/history';
import { openTask } from '@/features/chat/runtime/tasks';
import { pcModels } from '@/state/selectors';
import { S, update } from '@/state/store';
import { accountId, loadAssistants, storeAssistant, type PersonalAssistant } from './catalog';
import { personalExtra } from '@/features/phones/runtime/phoneCommander';
const creating = new Map<string, { request: Promise<string>; current: AuthGuard }>();
export function ensureConversation(a: PersonalAssistant): Promise<string> {
  const account = accountId(), requestKey = `${account}:${a.id}`;
  const previous = creating.get(requestKey); if (previous?.current()) return previous.request;
  const current = authAccount();
  const request = prepareConversation(a, account, current).finally(() => { if (creating.get(requestKey)?.request === request) creating.delete(requestKey); });
  creating.set(requestKey, { request, current }); return request;
}
async function prepareConversation(a: PersonalAssistant, account: string, current: AuthGuard) {
  a.directory = await invoke<string>('personal_directory', { account, id: a.id, name: a.name });
  if (!a.workspace) a.workspace = a.directory;
  const model = pcModels().find(m => m.id === S.model && !m.byok && !m.unavailable) ?? pcModels().find(m => !m.byok && !m.unavailable);
  if (!current()) throw new Error('账号已切换');
  if (!a.conversation && a.pendingCreate) throw new Error('创建结果尚未确认，请重新同步任务后再试，未重复创建');
  if (!loadAssistants(account).items.some(x => x.id === a.id)) throw new Error('账号没有这位助理');
  let row: CoreConversation;
  if (a.conversation) row = await api<CoreConversation>('GET', `/api/conversations/${a.conversation}`);
  else {
    if (!model?.providerId || !model.model) throw new Error('Lom账号模型尚未连接，请恢复连接后重试');
    if (!current()) throw new Error('账号已切换，未创建新会话');
    const bridge = await personalExtra();
    const skills = await conversationSkills();
    if (!current()) throw new Error('账号已切换，未创建新会话');
    a.pendingCreate = true; storeAssistant(a, account);
    try { row = await api<CoreConversation>('POST', '/api/conversations', { type: 'aionrs', name: `${a.name} · Personal Agent`,
      model: { provider_id: model.providerId, model: model.model },
      extra: { ...bridge, ...skills, workspace: a.workspace, session_mode: 'default', lom_personal: a.id, lom_personal_name: a.name,
        lom_personal_directory: a.directory, exclude_auto_inject_skills: EXCLUDED_AUTO_SKILLS, preset_rules: personalRules(a) } }); } catch (e) {
      if (current() && e instanceof CoreError && e.status && [400, 401, 403, 404, 405, 415, 422].includes(e.status)) { a.pendingCreate = false; storeAssistant(a, account); }
      throw e;
    }
    if (!current()) throw new Error('账号已切换，创建结果待核对');
    validateConversation(a, row);
    a.conversation = row.id; a.pendingCreate = false; storeAssistant(a, account);
  }
  if (!current()) throw new Error('账号已切换，原账号的会话已保留');
  validateConversation(a, row);
  const existing = S.convs.find(c => c.id === row.id);
  const c = existing ?? convFromCore(row);
  c.personal = { id: a.id, name: a.name, directory: a.directory, avatar: a.avatar };
  if (!existing) update(s => { s.convs.push(c); });
  await openTask(row.id, { refreshWorkspace: false, throwOnError: true });
  if (!current()) throw new Error('账号已切换');
  await applyPersonalPermission(a);
  if (!current()) throw new Error('账号已切换');
  return row.id;
}
function validateConversation(a: PersonalAssistant, row: CoreConversation) {
  if (!row?.id || row.type !== 'aionrs' || row.extra?.lom_personal !== a.id || row.extra?.lom_personal_directory !== a.directory || (a.conversation && row.id !== a.conversation))
    throw new Error('助理会话归属不一致，请核对后再打开');
}
export async function linkWorkspace(a: PersonalAssistant, workspace: string) {
  const owner = accountId(), current = authAccount();
  if (!loadAssistants().items.some(x => x.id === a.id) || !a.conversation) throw new Error('会话尚未就绪或账号已切换');
  validateConversation(a, await api<CoreConversation>('GET', `/api/conversations/${a.conversation}`));
  if (!current()) throw new Error('账号已切换，未关联目录');
  const changed = await api<CoreConversation>('PATCH', `/api/conversations/${a.conversation}`, { extra: { workspace } });
  if (!current()) throw new Error('账号已切换，目录关联结果待核对');
  if (changed.extra?.workspace !== workspace) throw new Error('核心未确认目录关联，原目录已保留');
  a.workspace = workspace; storeAssistant(a, owner);
  if (S.account?.id !== owner) throw new Error('账号已切换，目录关联保存在原账号');
  update(s => { const c = s.convs.find(c => c.id === a.conversation); if (c) c.workspace = workspace; });
}
