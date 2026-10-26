import { hideHistory } from '@/state/history';
import { scheduledMessage } from './scheduledMessage';
import { S } from '@/state/store';
import { compactNotice } from './commands';
import { applyAcpTool, toolImages } from './toolImages';
import type { Conv, Msg } from '@/state/types';
import { api } from '@/core/client';
import { archivedConversationIds } from './archived';
import { attachmentOfPath, fileChangeOf, isHtml, mergeFileChange, normCallId, splitFilesMarker, toolMsg } from './tools';
import type { CoreConversation, CoreMessage } from '@/core/types';
import { teammateMsg } from '@/features/teams/runtime/coreTeam';
import { channelOf } from './channelSource';

/* ===== lom-core 会话 ↔ 界面会话 ===== */

export const convFromCore = (c: CoreConversation): Conv => ({
  id: c.id, historyArchiveId: c.extra?.lom_history_id, historyContextPath: c.extra?.lom_history_context, historyRawPath: c.extra?.lom_history_raw, phoneScope: c.extra?.lom_phone_scope, personalScope: c.extra?.lom_personal_scope, owner: 'pc', title: c.name || '新的任务', updated: c.modified_at || c.created_at,
  ...(c.extra?.lom_personal ? { personal: { id: c.extra.lom_personal, name: c.extra.lom_personal_name || c.name, directory: c.extra.lom_personal_directory || '' } } : {}),
  preview: null, remote: true, workspace: c.extra?.workspace, loaded: false, messages: [], providerId: c.model?.provider_id, modelId: c.model ? `${c.model.provider_id}::${c.model.model}` : undefined,
  ...(c.type === 'acp' ? { agentId: c.extra?.agent_id, agentName: c.extra?.agent_name || c.extra?.backend || '其他 Agent', agentBackend: c.extra?.backend } : {}),
  parentTask: c.extra?.lom_parent, lomTier: c.extra?.lom_tier,
  ...(c.extra?.lom_side ? { sideOf: c.extra.lom_side } : {}),
  ...(c.type === 'acp' ? (c.extra?.thought_level ? { effort: c.extra.thought_level } : {}) : (c.extra?.reasoning_effort ? { effort: c.extra.reasoning_effort } : {})),
  // 团队会话不进「最近任务」：Lom 的团队编号；没有时用内核团队编号（例如别处建的内核团队）
  ...(c.extra?.lom_team ? { teamId: c.extra.lom_team } : c.extra?.teamId ? { teamId: `core:${c.extra.teamId}` } : {}),
});

let sideCleaned = false;

/** 电脑任务列表：包含定时执行产生的会话，便于查看结果；团队成员由团队页面展示 */
export async function listTasks(): Promise<Conv[]> {
  // 已归档的任务不回到列表（和分页并行读取）；读不到归档状态时照常显示，不让整张列表加载失败
  const archivedHistory = new Set<string>();
  const archivedRequest = archivedConversationIds(archivedHistory).catch(e => { console.warn('tasks.archived_unavailable', e); return new Set<string>(); });
  const items: CoreConversation[] = [];
  let cursor = '';
  const seen = new Set<string>();
  while (true) {
    const page = await api<{ items: CoreConversation[]; has_more?: boolean }>('GET', `/api/conversations?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    items.push(...page.items);
    if (!page.has_more) break;
    cursor = page.items.at(-1)?.id || '';
    if (!cursor || seen.has(cursor)) throw new Error('任务列表分页异常，无法完整恢复团队');
    seen.add(cursor);
  }
  // 侧边聊天是临时会话：不显示。启动后第一次读列表时，把上次没关干净的删掉（之后新开的由关闭时删除）
  if (!sideCleaned) {
    sideCleaned = true;
    for (const c of items) if (c.extra?.lom_side && !S.sideChat) void api('DELETE', `/api/conversations/${c.id}`).catch(() => {});
  }
  const archived = await archivedRequest;
  hideHistory(...archivedHistory);
  return items.filter(c => !archived.has(c.id) && !c.extra?.lom_side && (c.type === 'aionrs' || (c.type === 'acp' && !!c.extra?.agent_id)) &&
    !(c.extra as Record<string, unknown> | undefined)?.team_id && !(c.extra as Record<string, unknown> | undefined)?.lom_probe).map(convFromCore);
}

const textOf = (c: Record<string, unknown>) => (typeof c.content === 'string' ? c.content : '');

/** 同一次工具调用在历史里可能有多条记录（发起、结果），先算出每次调用的最终状态 */
function finalToolStatus(items: CoreMessage[]) {
  const status = new Map<string, 'running' | 'done' | 'error'>();
  for (const it of items) {
    if (it.type !== 'tool_call') continue;
    const c = it.content || {};
    const id = normCallId(c.call_id);
    const state = String(c.status || it.status || '');
    if (['error', 'failed', 'cancelled', 'canceled'].includes(state) || String(c.name ?? '').startsWith('cancelled:')) status.set(id, 'error');
    else if (status.get(id) !== 'error') {
      if (['running', 'pending', 'work'].includes(state)) status.set(id, 'running');
      else if (['completed', 'success', 'finish', 'done'].includes(state) || !state) status.set(id, 'done');
      else status.set(id, 'running'); // Unknown explicit progress must not manufacture a successful file write.
    }
  }
  return status;
}

/** 外部 Agent（Codex CLI 等）的版本提示：比内核验证过的版本新 → 不显示，能正常用；旧 → 换成 Lom 的说法提醒升级。
 * 返回 undefined 表示不是版本提示，照原样显示 */
function versionTip(c: Record<string, unknown>): string | undefined {
  const text = textOf(c);
  if (c.code === 'CLI_VERSION_NEWER' || /is newer than the version \S+ verified/i.test(text)) return '';
  if (c.code !== 'CLI_VERSION_OLDER' && !/is older than the version \S+ verified/i.test(text)) return undefined;
  const p = (c.params || {}) as Record<string, unknown>;
  return `本机的 ${String(p.cli || 'Agent')} 版本较旧${p.reported ? `（${String(p.reported)}）` : ''}，部分功能可能用不了，建议升级${p.verified ? `到 ${String(p.verified)} 或更新的版本` : ''}`;
}

/** 把历史记录转换成界面消息；成功的写文件类工具后面补「修改了文件」卡片，最后成功写入的 html 作为预览 */
export function mapHistory(items: CoreMessage[], conv: Conv): { messages: Msg[]; previewFile?: string } {
  const out: Msg[] = [];
  const seen = new Set<string>();
  const status = finalToolStatus(items);
  let previewFile: string | undefined;
  for (const it of items) {
    if (it.hidden) { const scheduled = scheduledMessage(it); if (scheduled) out.push(scheduled); continue; }
    const c = it.content || {};
    const at = it.created_at || Date.now();
    if (it.type === 'text') {
      const text = textOf(c);
      if (!text) continue;
      if (c.teammate_message) { const tm = teammateMsg(it.msg_id || it.id, at, c.sender_name, text); if (tm) out.push(tm); continue; } // 团队成员发来的消息
      const notice = it.position === 'right' ? null : compactNotice(text);
      if (it.position === 'right') {
        const shown = splitFilesMarker(text);
        // 压缩命令、目标自动推进这类隐藏消息不当成用户消息显示
        if (shown.text.trim() === '/compact' || (!shown.text.trim() && !shown.paths.length)) continue;
      }
      if (notice) { out.push({ id: it.id, type: 'system', at, text: notice, ic: 'check' }); continue; }
      if (it.position === 'right') {
        const { text: body, paths } = splitFilesMarker(text);
        out.push({ id: it.id, type: 'user', at, text: body, remoteId: it.msg_id, ...channelOf(text), ...(paths.length ? { attachments: paths.map(attachmentOfPath) } : {}) });
      } else {
        out.push({ id: it.id, type: 'assistant', at, text, agent: 'pc', remoteId: it.msg_id });
      }
    } else if (it.type === 'acp_tool_call') {
      applyAcpTool(out, c, at);
    } else if (it.type === 'tool_call') {
      const callId = normCallId(c.call_id);
      const name = String(c.name ?? '');
      if (seen.has(callId) || name.startsWith('cancelled:')) continue;
      seen.add(callId);
      const args = (c.args as Record<string, unknown>) || {};
      const m: Msg = { ...toolMsg(callId, name, args, conv.workspace), at, status: status.get(callId) ?? 'done' };
      if (typeof c.output === 'string') m.output = c.output;
      if (m.status === 'done') m.images = toolImages(c);
      out.push(m);
      const change = m.status === 'done' ? fileChangeOf(name, args, conv.workspace) : null;
      if (change) {
        mergeFileChange(out, change);
        const abs = String(args.file_path ?? '');
        if (isHtml(abs)) previewFile = abs;
      }
    } else if (it.type === 'tips' || it.type === 'error') {
      const tip = versionTip(c);
      const text = tip === undefined ? textOf(c) : tip;
      if (text) out.push({ id: it.id, type: 'system', at, text, ic: 'info' });
    }
  }
  return { messages: out, previewFile };
}

export async function loadHistory(conv: Conv) {
  const pages: CoreMessage[][] = [];
  const seen = new Set<string>();
  let before = '';
  while (true) {
    const page = await api<{ items: CoreMessage[]; oldest_cursor?: string | null; has_more_before?: boolean }>(
      'GET', `/api/conversations/${conv.id}/messages?limit=200${before ? `&before=${encodeURIComponent(before)}` : ''}`,
    );
    pages.unshift(page.items);
    if (!page.has_more_before) break;
    const cursor = page.oldest_cursor;
    if (!cursor || seen.has(cursor) || !page.items.length) throw new Error('chat.history_pagination：消息分页未前进，请重试');
    seen.add(cursor);
    before = cursor;
  }
  const messages = new Map<string, CoreMessage>();
  for (const page of pages) for (const item of page) messages.set(item.id, item);
  return mapHistory([...messages.values()], conv);
}
