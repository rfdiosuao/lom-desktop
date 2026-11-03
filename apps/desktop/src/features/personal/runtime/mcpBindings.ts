import { api } from '@/core/client';
import type { CoreConversation } from '@/core/types';
import type { Conv } from '@/state/types';
import { S, update } from '@/state/store';
import { authAccount } from '@/features/account/runtime/authScope';
import { listMcp, protectedMcp, testMcp, type McpServer } from '@/features/settings/runtime/mcpManager';
import { loadAssistants, storeAssistant, type PersonalAssistant } from './catalog';
import { personalCoreMode } from './permissions';

import { lockPersonalConfiguration, personalConfigUpdating } from './configurationLock';
const options = { timeoutMs: 30_000 };
type Info = CoreConversation & { runtime?: { has_task: boolean; is_processing: boolean } };
export interface AssistantMcpSnapshot {
  servers: Pick<McpServer, 'id' | 'name' | 'enabled' | 'last_test_status'>[];
  selected: string[]; missing: string[];
}
function owned(a: Pick<PersonalAssistant, 'id' | 'conversation' | 'directory'>) {
  const saved = loadAssistants().items.find(x => x.id === a.id && x.conversation === a.conversation && x.directory === a.directory);
  const c = S.convs.find(x => x.id === saved?.conversation && x.personal?.id === a.id && x.personal.directory === a.directory);
  if (!saved || !c) throw new Error('助理会话归属不一致，请重新打开');
  return { saved, c };
}
function validate(a: PersonalAssistant, row: Info) {
  if (row?.id !== a.conversation || row.type !== 'aionrs' || row.extra?.lom_personal !== a.id || row.extra.lom_personal_directory !== a.directory)
    throw new Error('核心会话归属不一致，未更新服务');
  const ids = row.extra.mcp_server_ids;
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('核心未提供有效 MCP 快照，请更新核心后重试');
  return ids;
}
async function snapshot(a: PersonalAssistant) {
  owned(a); const current = authAccount();
  const [row, servers] = await Promise.all([api<Info>('GET', `/api/conversations/${a.conversation}`, undefined, options), listMcp()]);
  if (!current()) throw new Error('账号已切换，未继续读取或更新服务');
  owned(a);
  return { row, servers, ids: validate(a, row) };
}
export async function readAssistantMcp(a: PersonalAssistant): Promise<AssistantMcpSnapshot> {
  const { row, servers, ids } = await snapshot(a);
  const internal = `lom-phone-${row.extra?.lom_personal_scope}`;
  return {
    servers: servers.filter(s => !protectedMcp(s)).map(({ id, name, enabled, last_test_status }) => ({ id, name, enabled, last_test_status })),
    selected: ids.filter(id => servers.some(s => s.id === id && !protectedMcp(s))),
    missing: ids.filter(id => !servers.some(s => s.id === id && s.name === internal) && !servers.some(s => s.id === id && !protectedMcp(s))),
  };
}
export function mcpBindingBlocker(c: Conv): string | undefined {
  if (personalConfigUpdating(c.id)) return '正在更新助理 MCP 服务，请等待更新结束';
  if (!c.personal) return;
  try { if (owned({ id: c.personal.id, directory: c.personal.directory, conversation: c.id }).saved.mcpRefreshPending) return '助理 MCP 更新尚未确认，请在助理管理中重新读取并保存服务选择'; }
  catch { /* The normal send path validates the profile; this guard does not grant access. */ }
}
function pending(a: PersonalAssistant, value: boolean) {
  const { saved } = owned(a);
  if (value) saved.mcpRefreshPending = true; else delete saved.mcpRefreshPending;
  storeAssistant(saved); update();
}
export async function saveAssistantMcp(a: PersonalAssistant, selected: string[]) {
  const { c } = owned(a), current = authAccount();
  if (personalConfigUpdating(c.id)) throw new Error('助理配置正在更新，请稍后重试');
  if (S.running[c.id]) throw new Error('助理正在执行任务，请结束后更新服务');
  const release = lockPersonalConfiguration(c.id); let attempted = false;
  try {
    const { row, servers, ids } = await snapshot(a);
    if (S.running[c.id] || row.runtime?.is_processing) throw new Error('助理正在执行任务，未更新服务');
    if (typeof row.runtime?.has_task !== 'boolean' || typeof row.runtime.is_processing !== 'boolean') throw new Error('核心未确认运行时状态');
    if (!Array.isArray(selected) || selected.some(id => !servers.some(s => s.id === id && !protectedMcp(s)))) throw new Error('服务列表已变化或选择包含内部服务，请重新读取');
    const scope = row.extra?.lom_personal_scope;
    const bridge = ids.filter(id => servers.some(s => s.id === id && s.name === `lom-phone-${scope}`));
    if (!scope || bridge.length !== 1) throw new Error('助理内部服务尚未就绪，请先正常发送一轮消息后重试');
    if (!current()) throw new Error('账号已切换，未保存服务');
    const target = [...new Set([...selected, ...bridge])];
    pending(a, true); attempted = true;
    const saved = await api<Info>('PATCH', `/api/conversations/${c.id}`, { extra: { selected_mcp_server_ids: target } }, options);
    if (!current()) throw new Error('账号已切换');
    const confirmed = validate(a, saved);
    if (confirmed.length !== target.length || target.some(id => !confirmed.includes(id))) throw new Error('核心未确认服务选择');
    owned(a);
    if (row.runtime.has_task) await api('POST', `/api/conversations/${c.id}/runtime/restart`, {}, options);
    if (!current()) throw new Error('账号已切换');
    owned(a);
    await api('POST', `/api/conversations/${c.id}/runtime/ensure`, {}, options);
    if (!current()) throw new Error('账号已切换');
    owned(a);
    await api('PUT', `/api/conversations/${c.id}/config-options/mode`, { value: personalCoreMode(c) }, options);
    if (!current()) throw new Error('账号已切换');
    pending(a, false);
  } catch (e) {
    if (attempted) throw new Error('MCP 更新未确认：服务选择可能已保存，运行时或权限恢复未确认。请重新读取并核对后保存，未自动重试。', { cause: e });
    throw e;
  } finally { release(); }
}

export async function testAssistantMcp(a: PersonalAssistant, id: string) {
  const current = authAccount(), { servers } = await snapshot(a);
  const server = servers.find(s => s.id === id && !protectedMcp(s));
  if (!server) throw new Error('服务列表已变化，请重新读取');
  const result = await testMcp(server);
  if (!current()) throw new Error('账号已切换，已丢弃连接测试结果');
  owned(a); return result;
}
