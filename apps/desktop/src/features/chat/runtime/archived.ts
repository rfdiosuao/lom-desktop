import { api } from '@/core/client';

/* ===== 已归档的会话 ID =====
 * 核心的 /api/conversations 列表不区分归档，归档状态只在侧栏接口里（?archived=1）。
 * 刷新任务列表时用它排除已归档的会话，否则刚归档的任务会随下一次刷新回到列表。 */

type Scope = { type: string; project_id?: string; key?: string };
type Item = { type: string; conversation?: { id: string; extra?: { lom_history_id?: string } }; member_conversation_ids?: string[] };
type Group = { scope: Scope; items: Item[]; has_more?: boolean; next_cursor?: string | null };

/** 分组翻页用的令牌，与核心 `win=` / `scope=` 的写法一致 */
const scopeToken = (s: Scope) =>
  s.type === 'pinned' || s.type === 'chats' ? s.type
    : s.type === 'project' && s.project_id ? `project:${s.project_id}`
      : s.type === 'dir' && s.key ? `dir:${s.key}` : '';

const MAX_PAGES = 50;

/** `history` 传入时顺带收集这些归档任务来自哪条导入历史（D34：这些历史不再回到列表） */
export async function archivedConversationIds(history?: Set<string>): Promise<Set<string>> {
  const ids = new Set<string>();
  const take = (items: Item[]) => {
    for (const item of items) {
      if (item.type === 'conversation' && item.conversation) {
        ids.add(item.conversation.id);
        if (item.conversation.extra?.lom_history_id) history?.add(item.conversation.extra.lom_history_id);
      }
      for (const id of item.member_conversation_ids || []) ids.add(id);
    }
  };
  const first = await api<{ groups: Group[] }>('GET', '/api/sidebar?archived=1&limit=100');
  for (const group of first.groups) {
    take(group.items);
    const token = scopeToken(group.scope);
    let cursor = group.has_more ? group.next_cursor : null;
    for (let page = 0; cursor && token && page < MAX_PAGES; page++) {
      const next = await api<{ items: Item[]; has_more?: boolean; next_cursor?: string | null }>('GET',
        `/api/sidebar/items?archived=1&limit=100&scope=${encodeURIComponent(token)}&cursor=${encodeURIComponent(cursor)}`);
      take(next.items);
      cursor = next.has_more ? next.next_cursor : null;
    }
  }
  return ids;
}
