import { invoke } from '@tauri-apps/api/core';
import type { CommanderCall } from '@/core/remoteWire';
import type { Conv } from '@/state/types';
import { S } from '@/state/store';
import { addAssistant, loadAssistants } from './catalog';
import { approveCapability } from './capabilityApproval';
import { dispatchOnce } from './sessionDispatch';
const result = (value: unknown, isError = false) => ({ isError, content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }] });
export const CAPABILITY_TOOLS = ['personal_assistant_create', 'personal_memory_merge', 'personal_memory_versions', 'personal_memory_rollback', 'personal_schedule_help'];
const choices: Record<string, string[]> = { language: ['zh', 'en'], length: ['concise', 'detailed'], format: ['table', 'bullets', 'paragraphs'], workflow: ['verify-result', 'read-source-first', 'check-prerequisites'] };
interface Versions { current_version: number; versions: { reason: string; version: { number: number } }[] }
const SCHEDULE_HELP = {
  status: 'instructions_only', scope: '当前助理会话；需 Lom/core 持续运行，手机提醒未开放',
  list: '"$AIONUI_HELPER_BIN" config cron current list',
  create: '"$AIONUI_HELPER_BIN" config cron current create',
  update: '"$AIONUI_HELPER_BIN" config cron current update',
  stdin_create: { name: '任务名称', schedule: '0 9 * * *', schedule_description: '每天9点', message: '具体任务' },
  stdin_update: { job_id: '从 list 的 data 中核对的 id', name: '任务名称', schedule: '15 9 * * *', schedule_description: '每天9:15', message: '具体任务' },
  rules: '用已有 ExecCommand 执行命令，create/update 从 stdin 读取 JSON。先 list 核对当前会话归属和完整任务，不修改未知 job_id；等 helper 确认后才说创建成功。缺少 ExecCommand/helper 时打开助理设置→定时任务。此工具本身不执行。',
};
function parameters(args: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(args).some(k => !allowed.includes(k))) throw new Error('personal.capability_arguments：不支持指定账号、助理、路径或来源正文');
}
function identity(self: Conv) {
  const a = loadAssistants().items.find(a => a.id === self.personal?.id && a.directory === self.personal?.directory && a.conversation === self.id);
  if (!a || !S.account?.id) throw new Error('personal.capability_owner：助理归属已变化');
  return { account: S.account.id, id: a.id, name: a.name, directory: a.directory };
}
async function mutate(self: Conv, call: CommanderCall, args: Record<string, unknown>, current: () => boolean) {
  const user = self.messages.findLast(m => m.type === 'user');
  if (!user?.text || user.source === 'schedule' || user.source === 'personal') throw new Error('personal.capability_source：需要当前用户提出操作，不接受定时或其他助理递归触发');
  const live = () => {
    try { return current() && self.messages.findLast(m => m.type === 'user') === user && !!identity(self); }
    catch { return false; } // Missing ownership deliberately denies a pending mutation.
  };
  if (call.name === 'personal_assistant_create') {
    parameters(args, ['name']); const name = String(args.name || '').trim();
    if (!name || name.length > 40) throw new Error('助理名称须为1至40个字符');
    if (loadAssistants().items.some(a => a.name === name)) throw new Error('已有同名助理，请先核对，未重复创建');
    if (!await approveCapability(`创建空白助理「${name}」；默认权限，不复制记忆、不创建会话或自动派活。`, live)) throw new Error('未批准、过期或停止，未创建');
    const a = await addAssistant(name);
    return result({ status: 'profile_created', assistant_id: a.id, name: a.name, conversation_created: false, note: '已保存，重新打开助理列表可见；尚未启动会话' });
  }
  const owner = identity(self);
  const snapshot = await invoke<Versions>('personal_memory_versions', { request: owner });
  if (!live()) throw new Error('助理已停止，未修改记忆');
  if (call.name === 'personal_memory_rollback') {
    parameters(args, ['version']); const version = Number(args.version);
    if (!Number.isSafeInteger(version) || !snapshot.versions.some(v => v.version.number === version)) throw new Error('请先 personal_memory_versions 核对最近版本');
    if (!await approveCapability(`恢复受管记忆版本 ${snapshot.current_version} → ${version}，追加新版本，不覆盖手写内容。`, live)) throw new Error('未批准，未回滚');
    return result({ status: 'rolled_back', version: await invoke('personal_memory_versions', { request: { ...owner, expected_version: snapshot.current_version, rollback: version } }) });
  }
  parameters(args, ['slot', 'value', 'quote']);
  const slot = String(args.slot || ''), value = String(args.value || ''), quote = String(args.quote || '');
  const literal = slot === 'fact' && value === quote && !/password|secret|api[_ ]key|access_token|private key|bearer |sk-|密码|密钥|令牌|私钥/i.test(value);
  if (!(choices[slot]?.includes(value) || literal) || !quote.trim() || new TextEncoder().encode(quote).length > 320 || !user.text.includes(quote)) throw new Error('personal.memory_scope：仅封闭偏好或 fact 用户原话(value==quote)，不推断、不存明显凭据。自由编辑请在助理设置文档编辑器核对保存');
  if (!await approveCapability(`记住 ${slot}=${value}\n用户原话：${quote}\n仅更新受管段，保留手写内容；fact 是用户陈述资料，不是权限或独立核实的事实。`, live)) throw new Error('未批准，未更新');
  return result(await invoke('personal_apply_learning', { request: { ...owner, turn: `${self.id}:capability:${call.id}`, user: user.text, reply: '', evidence: `${self.id}:${user.id}`, proposals: JSON.stringify([{ slot, value, quote }]), expected_version: snapshot.current_version } }));
}
export async function executeCapabilityTool(self: Conv, call: CommanderCall, current: () => boolean) {
  try {
    if (!current()) throw new Error('助理已停止或账号已变化');
    identity(self);
    const args = JSON.parse(call.arguments || '{}') as Record<string, unknown>;
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('参数必须是对象');
    let output;
    if (call.name === 'personal_schedule_help') { parameters(args, []); output = result(SCHEDULE_HELP); }
    else if (call.name === 'personal_memory_versions') { parameters(args, []); output = result(await invoke('personal_memory_versions', { request: identity(self) })); }
    else if (CAPABILITY_TOOLS.includes(call.name)) output = await dispatchOnce(call, `capability:${self.id}`, current, () => mutate(self, call, args, current));
    else throw new Error('未知能力工具');
    if (!current()) throw new Error('助理已停止或账号已变化；已批准操作请在助理列表或版本记录核对结果');
    return output;
  } catch (e) { return result(current() ? (e instanceof Error ? e.message : String(e)) : '助理已停止或账号已变化；已批准操作请在助理列表或版本记录核对结果', true); }
}
