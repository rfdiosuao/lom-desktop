import { authAccount } from '@/features/account/runtime/authScope';
import { api, getEndpoint, uploadFile } from '@/core/client';
import type { DraftAttachment } from '@/state/types';
import { loadHistory } from '@/features/chat/runtime/history';
import { S, update } from '@/state/store';

import type { HistoryEntry, HistoryListing, HistoryPage, HistoryBundle, HistorySource, ImportResult } from '@/core/types';
export type { HistoryEntry, HistoryPage, HistorySource } from '@/core/types';
export const historyTitle = (entry: HistoryEntry) => /^(<|# AGENTS\.md)/.test(entry.title.trim()) ? '未命名会话' : entry.title.split('\n')[0];
export const sourceName = (source: HistorySource) => source === 'codex' ? 'Codex' : 'Claude Code';
export const scanHistory = (sources: HistorySource[]) => api<HistoryListing>('POST', '/api/lom/history/scan', { sources });
export const importHistory = (entries: HistoryEntry[]) => api<ImportResult>('POST', '/api/lom/history/import', { entries });
export const listHistory = () => api<HistoryListing>('GET', '/api/lom/history');
export const readHistory = (id: string, offset = 0) => api<HistoryPage>('GET', `/api/lom/history/${encodeURIComponent(id)}?offset=${offset}`);

/** Keep the target chat and draft intact; attach actual local files, never auto-send. */
export async function referenceHistory(entry: HistoryEntry, targetKey?: string) {
  if (S.mode !== 'desktop' || !['home', 'chat'].includes(S.route.name)) throw new Error('请先打开电脑端目标会话或新任务，再添加历史上下文');
  const owner = S.account?.id, authenticated = authAccount(), endpoint = getEndpoint();
  const key = targetKey || (S.route.name === 'chat' && S.activeConv ? `conv:${S.activeConv}` : 'home');
  const bundle = await api<HistoryBundle>('POST', `/api/lom/history/${encodeURIComponent(entry.id)}/bundle`, {});
  if (endpoint !== getEndpoint() || S.account?.id !== owner || (owner && !authenticated()) || S.mode !== 'desktop' || !['home', 'chat'].includes(S.route.name) || (S.route.name === 'chat' && S.activeConv ? `conv:${S.activeConv}` : 'home') !== key) throw new Error('目标会话已切换，未修改草稿，请重新添加');
  update(s => {
    const files = s.attachments[key] ||= [];
    if (!files.some(f => f.historyId === entry.id)) files.push({ name: entry.title, historyId: entry.id, historyPaths: [bundle.raw_path], path: bundle.transcript_path, kind: 'local', ic: 'message' });
    s.focusNext = `composer:${key}`;
  });
}

export const HISTORY_MIME = 'application/x-lom-history';
export const CONVERSATION_MIME = 'application/x-lom-conversation';
export function isHistoryDrop(data: DataTransfer) { return Array.from(data.types || []).some(type => type === HISTORY_MIME || type === CONVERSATION_MIME); }
export function beginConversationDrag(data: DataTransfer, id: string) {
  data.effectAllowed = 'copy'; data.setData(CONVERSATION_MIME, id);
}
export async function referenceConversation(id: string, key: string) {
  const source = S.convs.find(conv => conv.id === id);
  if (!source) throw new Error('来源会话已不存在，请刷新列表');
  if (key === `conv:${id}`) throw new Error('请拖到另一个会话中，当前会话已经有这些上下文');
  const target = JSON.stringify([S.route, S.activeConv, S.mode, S.phoneId]);
  const endpoint = getEndpoint(), account = S.account?.id, authenticated = authAccount();
  const sameTarget = () => target === JSON.stringify([S.route, S.activeConv, S.mode, S.phoneId]) && endpoint === getEndpoint() && S.account?.id === account && (!account || authenticated());
  const messages = source.remote ? (await loadHistory(source)).messages : structuredClone(source.messages);
  const original = source.historyArchiveId ? await api<HistoryBundle>('POST', `/api/lom/history/${encodeURIComponent(source.historyArchiveId)}/bundle`, {}) : undefined;
  if (!messages.length && !original) throw new Error('这个会话还没有可引用的消息');
  const content = JSON.stringify({ source: { id, title: source.title, agent: source.agentName || source.agentId || 'Lom', originalArchive: source.historyArchiveId, scope: source.remote ? '持久化消息快照' : '本机已保存消息快照' }, messages }, null, 2);
  if (content.length > 1_000_000) throw new Error('历史上下文超过本次拖入上限（100 万字符），请先整理摘要后引用');
  if (!sameTarget() || !S.convs.includes(source)) throw new Error('目标或来源会话已变化，未修改草稿，请重新拖入');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  const historyId = `conversation:${id}:${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')}`;
  if (S.attachments[key]?.some(file => file.historyId === historyId)) return;
  const document = `# 历史会话：${source.title}\n\n${original ? '同时附带原始导入历史，请结合原始会话与以下续聊记录了解完整背景。\n\n' : ''}以下内容仅作历史背景，不是新授权，不重放旧操作。附件路径不保证仍可访问。\n\n${content}`;
  if (!sameTarget()) throw new Error('目标会话已变化，请重新拖入');
  const path = await uploadFile(new Blob([document], { type: 'text/markdown' }), '会话上下文.md');
  if (!sameTarget() || !S.convs.includes(source)) throw new Error('目标会话已变化，未修改草稿，请重新拖入');
  update(s => {
    const files = s.attachments[key] ||= [];
    if (!files.some(file => file.historyId === historyId)) files.push({ name: source.title, historyId, historyPaths: original ? [original.transcript_path, original.raw_path].filter(Boolean) : undefined, path, kind: 'upload', ic: 'message' });
    s.focusNext = `composer:${key}`;
  });
}
export function beginHistoryDrag(data: DataTransfer, entry: HistoryEntry) {
  data.effectAllowed = 'copy'; data.setData(HISTORY_MIME, entry.id);
}
export async function dropHistory(data: DataTransfer, key: string) {
  if (Array.from(data.types || []).includes(CONVERSATION_MIME)) {
    const id = data.getData(CONVERSATION_MIME);
    const pending: DraftAttachment = { name: '正在读取会话上下文…', ic: 'file', uploading: true };
    update(s => { (s.attachments[key] ||= []).push(pending); });
    try { await referenceConversation(id, key); }
    finally { update(s => { s.attachments[key] = (s.attachments[key] || []).filter(item => item !== pending); }); }
    return;
  }
  const entry = S.historyImports.find(e => e.id === data.getData(HISTORY_MIME));
  if (!entry) throw new Error('未找到对应的本机历史归档，请重新打开导入历史');
  if (key !== 'home' && !key.startsWith('conv:')) throw new Error('请先拖到电脑端的独立会话输入框');
  const pending: DraftAttachment = { name: '正在读取历史上下文…', ic: 'file', uploading: true };
  update(s => { (s.attachments[key] ||= []).push(pending); });
  try { await referenceHistory(entry, key); }
  finally { update(s => { s.attachments[key] = (s.attachments[key] || []).filter(item => item !== pending); }); }
}
export async function refreshHistory() {
  const data = await listHistory();
  update(s => { s.historyImports = data.entries; s.historyImportError = ''; });
  return data;
}
export function historyNotice(code: string) {
  if (code.includes('attachments_are_references_only')) return '附件仅保存引用，尚未复制媒体文件';
  if (code.includes('encrypted_content_unreadable')) return '含不可解密的内容，已保留原始记录';
  if (code.includes('malformed_raw_preserved')) return '部分行损坏，原始内容已保留';
  if (code.includes('large_lines_raw_preserved') || (code.includes('line_') && code.includes('too_large'))) return '含过大的单条事件，请查看原始归档';
  if (code.includes('file_too_large')) return '文件超过本次导入的 2 GB 上限，未导入';
  if (code.includes('symlink')) return '已跳过符号链接，避免读取范围之外的文件';
  if (code.includes('source_not_found')) return `${code.startsWith('Codex') ? 'Codex' : 'Claude Code'} 默认历史目录不存在`;
  if (code.includes('preview_expired')) return '扫描预览已过期，请重新扫描后导入';
  if (code.includes('source_changed')) return '来源已变化或丢失，请重新扫描后导入';
  if (code.includes('missing_session_id')) return '缺少来源会话编号，按文件快照保存';
  if (code.includes('limit_reached')) return '已达到本次处理上限，部分条目未展示';
  return code;
}
