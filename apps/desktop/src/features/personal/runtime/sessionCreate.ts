import { api } from '@/core/client';
import type { CoreConversation } from '@/core/types';
import { convFromCore } from '@/features/chat/runtime/history';
import { acpExtra, agentRow, usable } from '@/features/settings/runtime/agents';
import { savePhoneCache } from '@/features/phones/runtime/phoneCache';
import { S, update } from '@/state/store';
import { conversationSkills } from '@/features/skills/runtime/conversationSkills';
import { commanderExtra, COMMANDER_RULES } from '@/features/phones/runtime/phoneCommander';
import { EXCLUDED_AUTO_SKILLS, taskRules } from '@/features/settings/runtime/agentRules';
import type { Conv } from '@/state/types';

/** Creates a blank task without sending, navigating, or inheriting full-access permission. */
export async function createSession(self: Conv, args: Record<string, unknown>, current: () => boolean) {
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  if (!title || title.length > 160) throw new Error('title 必须为 1 到 160 字符');
  const agent = args.agent_id === undefined ? 'lom' : String(args.agent_id);
  if (!current()) throw new Error('助理已停止或账号已变化');
  if (agent !== 'lom' && agent.startsWith('dev_') && S.agents[agent]?.real) {
    const c: Conv = { id: crypto.randomUUID(), owner: agent, title, updated: Date.now(), messages: [], loaded: true, remote: false } as Conv;
    update(s => { s.convs.unshift(c); });
    try { await savePhoneCache(); }
    catch (e) { update(s => { s.convs = s.convs.filter(row => row !== c); }); throw e; }
    if (!current()) throw new Error('账号或助理状态已变化，已保存的草稿请在会话列表核对');
    return { status: 'prepared', session_id: c.id, title, agent_id: agent, remote_created: false, note: '手机本地空白草稿已保存，首次 session_send 才会创建手机端会话。' };
  }
  const external = agent === 'lom' ? undefined : agentRow(agent);
  if (agent !== 'lom' && !usable(external)) throw new Error('找不到可用 Agent；使用 session_list 的 agent_id 或用户已配置的 Agent');
  const [provider, ...modelParts] = (self.modelId || '').split('::');
  if (!external && (!self.providerId || !modelParts.join('::').trim())) throw new Error('个人助理的模型配置不完整，未创建会话');
  const workspace = self.workspace || self.personal?.directory;
  const extra = external ? { ...acpExtra(external), session_mode: 'default', exclude_auto_inject_skills: EXCLUDED_AUTO_SKILLS, ...(workspace ? { workspace } : {}) }
    : await defaultExtra(self, current, workspace);
  if (!current()) throw new Error('助理已停止或账号已变化，未创建新会话');
  let created: CoreConversation;
  try {
    created = await api<CoreConversation>('POST', '/api/conversations', {
      type: external ? 'acp' : 'aionrs', name: title,
      ...(!external ? { model: { provider_id: self.providerId || provider, model: modelParts.join('::') } } : {}), extra,
    });
  } catch { throw new Error('创建结果未确认；请先 session_list 核对，勿自动重试以免重复创建'); }
  if (!created || typeof created.id !== 'string' || !created.id.trim() || created.id.length > 256)
    throw new Error('创建结果未确认；核心未返回有效会话编号，请先核对列表，勿自动重试');
  if (!current()) throw new Error('助理已停止或账号已变化；空白会话可能已创建，请在列表核对');
  const c = { ...convFromCore(created), title, loaded: true };
  update(s => { s.convs.unshift(c); s.convPhones[c.id] = []; });
  return { status: 'created', session_id: c.id, title, agent_id: agent, remote_created: true };
}

/** Fresh ordinary task capabilities; never copy the parent's personal bridge or permission tier. */
async function defaultExtra(self: Conv, current: () => boolean, workspace?: string) {
  const skills = await conversationSkills();
  if (!current()) throw new Error('助理已停止或账号已变化，未创建新会话');
  const bridge = await commanderExtra();
  if (!current()) throw new Error('助理已停止或账号已变化，未创建新会话');
  return { ...skills, ...bridge, ...(workspace ? { workspace } : {}), ...(self.lomTier ? { lom_tier: self.lomTier } : {}),
    session_mode: 'default', preset_rules: taskRules(true, COMMANDER_RULES), exclude_auto_inject_skills: EXCLUDED_AUTO_SKILLS };
}
