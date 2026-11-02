import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/core/client';
import type { ActivityCursor, ActivityDirection, ActivityKind, ActivityPage, TeamMailboxMessage, TeamTask } from './activityTypes';
import { subscribeActivity, subscribeActivityReconnect } from './activityEvents';

/* D33 团队活动流：一个游标翻两种内容（消息 + 任务）。
 * 返回的条目按 id 存两张表，合并/去重发生在这里；方向、内容和团队变化时重置游标重新取第一页。
 * 旧请求用 epoch 丢弃，WS 事件按 id 原位更新或插入，不整页重拉。 */

const PAGE_SIZE = 100;

export interface TeamActivityFeed {
  messages: TeamMailboxMessage[];
  tasks: TeamTask[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string;
  loadMore: () => void;
  retry: () => void;
}

type ItemMap<T> = Record<string, T>;

export function useTeamActivityFeed(
  teamId: string | undefined,
  active: boolean,
  direction: ActivityDirection,
  kind: ActivityKind,
): TeamActivityFeed {
  const [messagesById, setMessagesById] = useState<ItemMap<TeamMailboxMessage>>({});
  const [tasksById, setTasksById] = useState<ItemMap<TeamTask>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');

  const cursorRef = useRef<ActivityCursor | undefined>(undefined);
  const hasMoreRef = useRef(false);
  const epochRef = useRef(0);
  const loadingRef = useRef(false);

  // WS 处理要用最新窗口判断边界，不能在每次状态变化时重新订阅。
  const messagesRef = useRef(messagesById);
  const tasksRef = useRef(tasksById);
  messagesRef.current = messagesById;
  tasksRef.current = tasksById;

  const applyPage = useCallback((items: ActivityPage['items']) => {
    const messages: ItemMap<TeamMailboxMessage> = {};
    const tasks: ItemMap<TeamTask> = {};
    for (const item of items) {
      if (item.kind === 'message' && item.message) messages[item.message.id] = item.message;
      else if (item.kind === 'task' && item.task) tasks[item.task.id] = item.task;
      else console.warn('team.activity_page_item_ignored', item.id, 'kind 与载荷不一致');
    }
    if (Object.keys(messages).length) setMessagesById((prev) => ({ ...prev, ...messages }));
    if (Object.keys(tasks).length) setTasksById((prev) => ({ ...prev, ...tasks }));
  }, []);

  const fetchPage = useCallback(async (reset: boolean) => {
    if (!teamId) return;
    if (loadingRef.current) return;
    if (!reset && !hasMoreRef.current) return;
    loadingRef.current = true;
    const epoch = epochRef.current;
    if (reset) setIsLoading(true); else setIsLoadingMore(true);
    try {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE), direction, kind });
      const cursor = reset ? undefined : cursorRef.current;
      if (cursor) { query.set('cursor_ts', String(cursor.ts)); query.set('cursor_id', cursor.id); }
      const page = await api<ActivityPage>('GET', `/api/teams/${encodeURIComponent(teamId)}/activity?${query.toString()}`);
      if (epoch !== epochRef.current) return; // 已被新的方向/内容/团队取代
      if (reset) { setMessagesById({}); setTasksById({}); }
      applyPage(page.items ?? []);
      cursorRef.current = page.next_cursor ?? undefined;
      hasMoreRef.current = Boolean(page.has_more);
      setHasMore(hasMoreRef.current);
      setError('');
    } catch (e) {
      if (epoch === epochRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (epoch === epochRef.current) {
        setIsLoading(false);
        setIsLoadingMore(false);
        loadingRef.current = false;
      }
    }
  }, [teamId, direction, kind, applyPage]);

  const resetAndReload = useCallback(() => {
    epochRef.current += 1;
    cursorRef.current = undefined;
    hasMoreRef.current = false;
    loadingRef.current = false;
    setMessagesById({});
    setTasksById({});
    setHasMore(false);
    void fetchPage(true);
  }, [fetchPage]);

  useEffect(() => {
    if (!active || !teamId) return;
    resetAndReload();
  }, [active, teamId, direction, kind, resetAndReload]);

  const loadMore = useCallback(() => { void fetchPage(false); }, [fetchPage]);

  useEffect(() => {
    if (!active || !teamId) return;
    const edge = (): ActivityCursor | null => {
      let newest: ActivityCursor | null = null;
      for (const m of Object.values(messagesRef.current)) if (!newest || m.created_at > newest.ts) newest = { ts: m.created_at, id: m.id };
      for (const t of Object.values(tasksRef.current)) if (!newest || t.created_at > newest.ts) newest = { ts: t.created_at, id: t.id };
      return newest;
    };
    const shouldInsert = (ts: number, id: string): boolean => {
      if (direction === 'asc') return !hasMoreRef.current; // 升序只有最新端已加载才追加
      const newest = edge();
      return !newest || ts > newest.ts || (ts === newest.ts && id > newest.id);
    };

    const unsubscribe = subscribeActivity((event) => {
      if (event.teamId !== teamId) return;
      if (event.type === 'mailbox') {
        const m = event.message;
        setMessagesById((prev) => (prev[m.id] ? { ...prev, [m.id]: m } : shouldInsert(m.created_at, m.id) ? { ...prev, [m.id]: m } : prev));
      } else {
        const t = event.task;
        setTasksById((prev) => (prev[t.id] ? { ...prev, [t.id]: t } : shouldInsert(t.created_at, t.id) ? { ...prev, [t.id]: t } : prev));
      }
    });
    const unsubscribeReconnect = subscribeActivityReconnect(resetAndReload);
    return () => { unsubscribe(); unsubscribeReconnect(); };
  }, [active, teamId, direction, resetAndReload]);

  const messages = useMemo(() => Object.values(messagesById), [messagesById]);
  const tasks = useMemo(() => Object.values(tasksById), [tasksById]);

  return { messages, tasks, isLoading: active && isLoading, isLoadingMore, hasMore, error, loadMore, retry: resetAndReload };
}
