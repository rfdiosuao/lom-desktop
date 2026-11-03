import diagnostics from '../../../../src-tauri/src/personal_diagnostic_tools.json';
import sessions from '../../../../src-tauri/src/session_tools.json';
import phones from '../../../../src-tauri/src/phone_tools.json';
import feishu from '../../../../src-tauri/src/feishu_tools.json';
import { agentState } from '@/features/settings/runtime/agentState';
import { S } from '@/state/store';

/** Schema source is also loaded by the native bridge; discovery never grants execution rights. */
interface Tool { name: string; description: string; inputSchema: object }
export const DIAGNOSTIC_TOOLS = diagnostics;
export const definitions: Tool[] = [...sessions, ...feishu, ...phones.filter(t => DIAGNOSTIC_TOOLS.includes(t.name))];
const readTools = new Set(['session_list', 'session_read', 'session_wait', 'personal_memory_versions', 'personal_schedule_help', 'personal_capabilities', 'personal_targets', ...DIAGNOSTIC_TOOLS]);
const writesFeishu = new Set(['feishu_send_message', 'feishu_create_doc', 'feishu_append_doc', 'feishu_send_file', 'feishu_send_image']);
const idOf = (name: string) => `lom.personal.${name}`;
const clip = (text: string) => text.slice(0, 160);

export function catalogPage(args: Record<string, unknown>, max: number) {
  const offset = args.offset ?? 0, limit = args.limit ?? Math.min(10, max);
  if (!Number.isSafeInteger(offset) || Number(offset) < 0 || !Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > max)
    throw new Error('personal.catalog_page：offset 必须为非负整数，limit 超出范围');
  return { offset: Number(offset), limit: Number(limit) };
}
function parameters(args: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(args).some(k => !allowed.includes(k))) throw new Error('personal.catalog_arguments：不支持这些参数');
}
function descriptor(tool: Tool, schema: boolean) {
  const connector = tool.name.startsWith('feishu_'), diagnostic = DIAGNOSTIC_TOOLS.includes(tool.name);
  return {
    id: idOf(tool.name), tool: tool.name, version: 1,
    description: tool.name === 'phone_list' ? '列出已配对手机，仅供诊断，不授予手机控制权限。' : tool.description,
    effect: connector ? (writesFeishu.has(tool.name) ? 'write' : 'read') : readTools.has(tool.name) ? 'read' : 'write',
    adapter: connector ? 'feishu' : diagnostic ? 'personal-diagnostic' : tool.name.startsWith('session_') ? 'session' : 'personal',
    availability: 'registered', verified_on_current_device: false,
    prerequisites: ['当前账号的 Personal Agent 正在运行', '实际调用仍核对账号、目标归属及既有权限', ...(connector ? ['当前助理已授权飞书连接；工具实际调用核对登录状态'] : [])],
    ...(schema ? { input_schema: tool.inputSchema } : {}),
  };
}

export function discoverCapabilities(args: Record<string, unknown>) {
  parameters(args, ['id', 'query', 'offset', 'limit']);
  const { offset, limit } = catalogPage(args, 20);
  if (args.id !== undefined) {
    if (typeof args.id !== 'string') throw new Error('能力 ID 必须为字符串');
    const tool = definitions.find(t => idOf(t.name) === args.id || t.name === args.id);
    if (!tool) throw new Error('personal.capability_unknown：此版本没有注册该管理能力');
    return { version: 1, capability: descriptor(tool, true) };
  }
  if (args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 100)) throw new Error('查询必须是最多100字的字符串');
  const query = String(args.query || '').trim().toLowerCase();
  const rows = definitions.filter(t => `${t.name} ${t.description}`.toLowerCase().includes(query));
  return { version: 1, source: 'desktop-native-tool-registry', total: rows.length,
    next_offset: offset + limit < rows.length ? offset + limit : null,
    capabilities: rows.slice(offset, offset + limit).map(t => descriptor(t, false)),
    limitations: ['目录仅覆盖此版本内置 PA 管理工具；不包含运行时独立绑定的 MCP 或技能', 'registered 不代表已授权、设备在线或操作成功', '团队创建/启动、跨存储历史搜索与统一停止尚未接入'],
  };
}

export function discoverTargets(args: Record<string, unknown>) {
  parameters(args, ['kind', 'offset', 'limit']);
  const { offset, limit } = catalogPage(args, 50);
  let rows: object[];
  if (args.kind === 'agents') rows = (S.agentCatalog ?? []).map(a => ({
    id: a.id, name: clip(a.name), executor: 'desktop-agent', observed_state: agentState(a), enabled: a.enabled, installed: a.installed,
  }));
  else if (args.kind === 'phones') rows = Object.values(S.agents).filter(a => a.real && a.kind === 'phone').map(a => ({
    id: a.id, name: clip(a.name), executor: 'phone', observed_state: a.status, last_seen: a.lastSeen ?? null,
  }));
  else if (args.kind === 'teams') rows = S.teams.filter(t => t.real && !!S.account?.id && t.ownerAccountId === S.account.id).map(t => ({
    id: t.id, name: clip(t.name), executor: 'team', core_team_id: t.core?.id ?? null,
    configured_members: t.members.length, phase: t.core ? 'core_link_recorded' : 'configured',
    management_tools_connected: false,
  }));
  else throw new Error('personal.target_kind：请选择 agents、teams 或 phones');
  return { version: 1, kind: args.kind, source: 'desktop-loaded-snapshot', observed_at: Date.now(),
    total: rows.length, next_offset: offset + limit < rows.length ? offset + limit : null, targets: rows.slice(offset, offset + limit),
    synchronized: false, catalog_loaded: args.kind === 'agents' ? S.agentCatalog !== null : null,
    limitations: ['只返回当前桌面已加载记录，未探测目标、未派工、未搜索远端历史', '记录可能过时；调用时需再次验证可用性。core_link_recorded 不等于正在运行', '团队只列出归属当前账号的记录；旧版无归属记录保留在UI，但不向管理工具披露。电脑Agent是本机配置，不是云端账号资产'],
  };
}
