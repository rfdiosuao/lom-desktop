import { stripSettingsContext } from '@/features/settings/runtime/preferences';
import type { Attachment, FileChange, Msg } from '@/state/types';
import { fileStreamUrl } from '@/core/client';
import { basename, uid } from '@/shared/lib/util';
import { S } from '@/state/store';

/* ===== 工具调用的展示：把 Agent 的工具名和参数翻译成原型里的「事件卡片」 ===== */

const LABELS: Record<string, string> = {
  imageGeneration: '生成图片',
  Read: '读取文件', Write: '写入文件', Edit: '修改文件', MultiEdit: '修改文件',
  ExecCommand: '运行命令', Bash: '运行命令', Grep: '搜索内容', Glob: '查找文件',
  Skill: '调用技能', Spawn: '派生子任务', EnterPlanMode: '进入规划', ExitPlanMode: '完成规划',
  ToolSearch: '查找工具', WebSearch: '联网搜索', LomWebSearch: '联网搜索', LomWebFetch: '读取网页', WebFetch: '读取网页', TodoWrite: '更新计划',
};

export const toolLabel = (name: string) => LABELS[name] ?? name;

/** 统一工具调用 id：流式事件和历史记录里同一次调用可能带不同前缀 */
export const normCallId = (id: unknown) => String(id ?? '').replace(/^aionrs-/, '');

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));

export const relPath = (p: string, workspace?: string) =>
  workspace && p.startsWith(workspace) ? p.slice(workspace.length).replace(/^[\\/]/, '') || basename(p) : p;

/** 卡片副标题：从参数里挑最能说明这次调用的一项 */
export function toolDetail(args: Record<string, unknown> = {}, workspace?: string) {
  const file = str(args.file_path ?? args.path ?? args.filePath);
  if (file) return relPath(file, workspace);
  const pick = args.command ?? args.cmd ?? args.pattern ?? args.query ?? args.url ?? args.skill ?? args.name ?? args.description ?? args.prompt;
  return str(pick).slice(0, 160);
}

/* 工具调用的一句话说明：Lom 自己的手机 / 派活工具翻成「做了什么」，其他工具用「名称：对象」 */
const clip = (v: unknown, n = 40) => { const t = str(v).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const phoneName = (a: Record<string, unknown>) => S.agents[str(a.device)]?.name || '手机';
const taskAgent = (a: Record<string, unknown>) => {
  const c = S.convs.find(x => x.id === str(a.task_id));
  return c?.agentName || c?.title || '成员';
};
/** 内核团队工具里的 slot_id → 成员名 */
const slotName = (slot: unknown) => {
  for (const t of S.teams) {
    const mid = Object.entries(t.core?.slots || {}).find(([, v]) => v === str(slot))?.[0];
    const m = mid ? t.members.find(x => x.mid === mid) : undefined;
    if (m) return m.leader ? 'Leader' : S.agentCatalog?.find(a => `ag:${a.id}` === m.agent)?.name || S.agents[m.agent]?.name || m.role;
  }
  return '成员';
};
const TASK_STATUS: Record<string, string> = { pending: '待办', in_progress: '进行中', completed: '已完成', deleted: '已删除' };
const CONTROL: Record<string, string> = { tap: '点击', swipe: '滑动', type: '输入文字', back: '返回', home: '回到桌面', open_app: '打开应用' };
const BRIDGE: Record<string, (a: Record<string, unknown>) => string> = {
  phone_list: () => '查看可以指挥的手机',
  phone_status: a => `查看${phoneName(a)}的在线状态、电量和网络`,
  phone_apps: a => `查看${phoneName(a)}装了哪些应用`,
  phone_screenshot: a => `看一眼${phoneName(a)}的屏幕`,
  phone_ui_tree: a => `读取${phoneName(a)}当前页面的内容`,
  phone_control: a => `在${phoneName(a)}上${CONTROL[str(a.action)] || str(a.action) || '操作'}${a.text ? `「${clip(a.text, 20)}」` : a.package_name ? `：${str(a.package_name)}` : ''}`,
  phone_task_start: a => `${a.session_id ? '继续' : '派'}任务给${phoneName(a)}：${clip(a.text)}`,
  phone_task_read: a => `读取${phoneName(a)}的任务进度`,
  phone_task_cancel: a => `取消${phoneName(a)}的任务`,
  agent_list: () => '查看可以派活的电脑 Agent',
  agent_task_start: a => a.task_id ? `给${taskAgent(a)}追加任务：${clip(a.text)}` : `派任务给 ${str(a.agent).replace(/^ag:/, '') || 'Agent'}：${clip(a.text)}`,
  agent_task_read: a => `读取${taskAgent(a)}的任务结果`,
  agent_task_cancel: a => `取消${taskAgent(a)}的任务`,
  lom_view_image: a => `看图${a.question ? `：${clip(a.question)}` : ''}`,
  team_members: () => '查看团队成员',
  team_read_messages: () => '查看团队消息',
  team_send_message: a => `发消息给 ${slotName(a.to)}：${clip(a.message)}`,
  team_task_create: a => `${a.owner ? `派任务给 ${slotName(a.owner)}` : '新建任务'}：${clip(a.subject)}`,
  team_task_update: a => `更新任务${a.status ? `为「${TASK_STATUS[str(a.status)] || str(a.status)}」` : ''}`,
  team_task_list: () => '查看团队任务板',
  team_interrupt_agent: a => `打断 ${slotName(a.slot_id)}：${clip(a.message)}`,
};

/** 工具调用显示成一句话，例如「运行命令：sleep 8」「读取 CodeBuddy 的任务结果」 */
export function toolSentence(m: Msg): string {
  const raw = (m.toolName || m.tool || '').replace(/^mcp__.+?__/, '');
  const bridge = BRIDGE[raw];
  if (bridge) return bridge(m.args || {});
  const name = m.tool && m.tool !== m.toolName ? m.tool : toolLabel(raw || '工具');
  return m.detail ? `${name}：${m.detail}` : name;
}

const countLines = (s: unknown) => (typeof s === 'string' && s ? s.split('\n').length : 0);

/** 写文件类工具完成后对应的文件变更（用于「修改了 N 个文件」卡片） */
export function fileChangeOf(name: string, args: Record<string, unknown> = {}, workspace?: string): FileChange | null {
  const file = str(args.file_path ?? args.path);
  if (!file) return null;
  if (name === 'Write') return { path: relPath(file, workspace), add: countLines(args.content), del: 0 };
  if (name === 'Edit' || name === 'MultiEdit') return { path: relPath(file, workspace), add: countLines(args.new_string), del: countLines(args.old_string) };
  return null;
}

export const isHtml = (p: string) => /\.html?$/i.test(p);

export function toolMsg(callId: string, name: string, args: Record<string, unknown>, workspace?: string): Msg {
  const body = typeof args.content === 'string' ? `${args.content.slice(0, 600)}${args.content.length > 600 ? '…' : ''}` : '';
  return {
    id: uid('m'), type: 'tool', at: Date.now(), callId, tool: toolLabel(name), detail: toolDetail(args, workspace),
    status: 'running', output: body, toolName: name, args,
  };
}

/** 把一条文件变更并入同一轮里最近的「修改了文件」卡片；没有就新建 */
export function mergeFileChange(list: Msg[], change: FileChange) {
  const last = [...list].reverse().find(m => m.type === 'files' || m.type === 'user');
  if (last && last.type === 'files') {
    const same = last.changes?.find(c => c.path === change.path);
    if (same) { same.add += change.add; same.del += change.del; } else last.changes?.push(change);
    return;
  }
  list.push({ id: uid('m'), type: 'files', at: Date.now(), changes: [change] });
}

/** 从任意结构里取一段可读的错误文字 */
export const errorText = (d: Record<string, unknown>) =>
  str(d.message ?? d.error ?? d.content ?? d.detail ?? d.reason) || '执行出错';

const QUOTA_RE = /额度不足|額度不足|预扣费额度失败|預扣費額度失敗|insufficient user quota|not enough quota|insufficient funds/i;
const INVALID_KEY_RE = /无效的令牌|無效的令牌|invalid token/i;

/** 把 Lom 云端（星钥网关）的报错翻译成用户能看懂、知道怎么办的话（S04-01 AC-5）；不是 Lom 云端的任务原样显示 */
export function friendlyModelError(text: string, usesLomCloud: boolean): string {
  if (!usesLomCloud) return text;
  if (QUOTA_RE.test(text)) return '积分不足：Lom 云端模型暂时不能用了。可以在「充值积分」里输入兑换码，或者在模型菜单里改用自带 Key 的模型。';
  if (INVALID_KEY_RE.test(text)) return '积分已用完或登录凭据失效：请先充值积分；如果积分还有剩余，请在账号菜单里退出后重新登录。';
  return text;
}

/* ---------- 用户消息里的附件标记 ----------
 * 核心保存和推送用户消息时，会在正文后追加 `\n\n[[AION_FILES]]\n路径1\n路径2`（lom-core aionui-ai-agent/src/media.rs）。
 * 界面上拆回正文 + 附件；去重时只比较正文。 */
const FILES_MARKER = '[[AION_FILES]]';
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;

export function splitFilesMarker(content: string): { text: string; paths: string[] } {
  content = stripSettingsContext(content);
  const i = content.lastIndexOf(FILES_MARKER);
  if (i < 0) return { text: content, paths: [] };
  const paths = content.slice(i + FILES_MARKER.length).split('\n').map(l => l.trim()).filter(Boolean);
  return { text: content.slice(0, i).replace(/\n\n$/, ''), paths };
}

/** 历史记录里的附件：图片用本地文件流做缩略图（只在 Lom 自己的界面里显示，不进预览 iframe） */
export const attachmentOfPath = (p: string): Attachment =>
  IMAGE_EXT.test(p) ? { name: basename(p), path: p, ic: 'image', preview: fileStreamUrl(p) || undefined } : { name: basename(p), path: p, ic: 'file' };
