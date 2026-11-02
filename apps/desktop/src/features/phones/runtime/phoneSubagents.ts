import type { PhoneSubAgent, PhoneSubAgents, SubAgentAction, SubAgentWrite } from '@/core/remoteWire';
import { authAccount, type AuthGuard } from '@/features/account/runtime/authScope';
import { S, update } from '@/state/store';
import { phoneRpc } from './phoneRpc';

type Group = Pick<PhoneSubAgent, 'id' | 'name'>;
export interface SubagentSnapshot {
  items: PhoneSubAgent[]; groups: Group[]; delegationEnabled: boolean;
  loaded: boolean; busy: boolean; error: string;
}
type Entry = SubagentSnapshot & { current: AuthGuard };
const entries = new Map<string, Entry>();
const empty: SubagentSnapshot = { items: [], groups: [], delegationEnabled: false, loaded: false, busy: false, error: '' };
export const phoneSubagents = (device: string): SubagentSnapshot => {
  const entry = entries.get(device);
  return entry?.current() ? entry : empty;
};

const errors: Record<string, string> = {
  'subagent.invalid_id': '子代理标识无效，请刷新后重新创建或编辑',
  'subagent.missing': '手机上已找不到这个子代理，请刷新列表',
  'subagent.limit': '手机子代理数量已达到上限',
  'subagent.builtin': '内置子代理不能删除或改名',
  'subagent.invalid_enabled': '启用状态无效，请重新选择',
  'subagent.invalid_definition': '名称或工作指令不符合手机要求，请检查后重试',
  'subagent.model_missing': '手机模型分组已不存在，请刷新后重新选择',
  'subagent.duplicate_name': '手机上已有同名子代理，请换一个名称',
  'subagent.not_ready': '手机子代理尚未就绪，请打开手机 App 后重试',
  'subagent.persist_failed': '保存结果未确认，请刷新手机状态后重试',
  'sync.conflict': '手机内容已更新，未覆盖。请保留草稿并重新载入手机版本',
  'remote.method_unknown': '当前手机版本不支持管理子代理，请更新手机 App',
  'remote.not_ready': '手机尚未就绪，请打开手机 App 后重试',
  'remote.operation_failed': '手机操作结果未确认，请刷新状态后重试',
  'remote.expired': '手机授权已过期，请重新连接并授权',
  'remote.revoked': '手机已撤销此电脑的权限，请重新授权',
};
function failure(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return Object.assign(new Error(errors[code || message] || message), { code });
}

function available(device: string) {
  if (!authAccount()()) throw new Error('请先登录后管理手机子代理');
  const phone = S.agents[device];
  if (!phone?.real || phone.kind !== 'phone') throw new Error('请选择真实配对手机，示例手机不能同步子代理');
  if (phone.status !== 'online') throw new Error('手机离线，请打开手机 App 并连接后重试');
}
function booleanValue(value: string) {
  if (value !== 'true' && value !== 'false') throw new Error('手机子代理回复格式无效，请更新手机端后重试');
  return value === 'true';
}
function parse(reply: PhoneSubAgents): Pick<SubagentSnapshot, 'items' | 'groups' | 'delegationEnabled'> {
  let items: PhoneSubAgent[], groups: Group[];
  try { items = JSON.parse(reply.items); groups = JSON.parse(reply.groups); }
  catch { throw new Error('手机子代理回复格式无效，请更新手机端后重试'); }
  if (!Array.isArray(items) || !Array.isArray(groups)) throw new Error('手机子代理列表格式无效');
  const ids = new Set<string>();
  for (const item of items) {
    if (!item || ['id', 'name', 'description', 'instructions', 'model_group', 'enabled', 'builtin', 'revision'].some(key => typeof item[key as keyof PhoneSubAgent] !== 'string') || !item.id || !item.revision || ids.has(item.id)) throw new Error('手机子代理条目格式无效');
    booleanValue(item.enabled); booleanValue(item.builtin); ids.add(item.id);
  }
  if (groups.some(group => !group || typeof group.id !== 'string' || !group.id || typeof group.name !== 'string') || new Set(groups.map(group => group.id)).size !== groups.length) throw new Error('手机模型分组格式无效');
  return { items, groups, delegationEnabled: booleanValue(reply.delegation_enabled) };
}

async function exchange(device: string, method: string, payload: SubAgentWrite | SubAgentAction | Record<string, never>) {
  available(device);
  if (phoneSubagents(device).busy) throw new Error('正在同步手机子代理，请等待当前操作完成');
  const previous = phoneSubagents(device), current = authAccount();
  const entry: Entry = { ...previous, busy: true, error: '', current };
  update(() => entries.set(device, entry));
  try {
    const reply = parse(await phoneRpc<PhoneSubAgents>(device, method, payload));
    if (!current() || entries.get(device) !== entry || !S.agents[device]?.real) throw new Error('账号或设备已变化，请重新加载手机子代理');
    update(() => Object.assign(entry, reply, { loaded: true, busy: false }));
    return entry;
  } catch (error) {
    const rejected = failure(error);
    if (current() && entries.get(device) === entry) update(() => { entry.busy = false; entry.error = rejected.message; });
    throw rejected;
  }
}
export const loadPhoneSubagents = (device: string) => exchange(device, 'subagent.list', {});

export function savePhoneSubagent(device: string, input: SubAgentWrite) {
  const state = phoneSubagents(device), prior = state.items.find(item => item.id === input.id);
  if (!state.loaded) throw new Error('请先加载手机子代理后再保存');
  if ((prior?.revision || '') !== input.revision) throw new Error('子代理版本已变化，请保留草稿并重新打开编辑');
  if (prior?.builtin === 'true' && input.name !== prior.name) throw new Error('内置子代理不能改名');
  if (!input.name.trim() || !input.instructions.trim()) throw new Error('请填写名称和工作指令');
  if (input.model_group && !state.groups.some(group => group.id === input.model_group)) throw new Error('手机模型分组已不存在，请重新选择');
  booleanValue(input.enabled);
  return exchange(device, 'subagent.save', input);
}
export function changePhoneSubagent(device: string, action: 'toggle' | 'delete', input: SubAgentAction) {
  const prior = phoneSubagents(device).items.find(item => item.id === input.id);
  if (!prior || prior.revision !== input.revision) throw new Error('子代理版本已变化，请重新加载后操作');
  if (action === 'delete' && prior.builtin === 'true') throw new Error('内置子代理不能删除');
  booleanValue(input.enabled);
  return exchange(device, `subagent.${action}`, input);
}
