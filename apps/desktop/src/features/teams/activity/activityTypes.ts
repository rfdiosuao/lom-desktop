import type { PhoneActivity } from './phoneActivity';
/* D33 团队活动看板：接口类型、泳道归属、排序与筛选。
 * 行为参考 AionUi 的团队活动视图（Apache-2.0），按 Lom 的类型和写法重写。 */

export type ActivityDirection = 'desc' | 'asc';
export type ActivityKind = 'all' | 'message' | 'task';

export interface TeamMailboxMessage {
  id: string; team_id: string; from_agent_id: string; to_agent_id: string;
  msg_type: string; content: string; summary?: string | null; files: string[];
  read: boolean; created_at: number;
}

export interface TeamTask {
  id: string; team_id: string; subject: string; description?: string | null;
  status: string; owner?: string | null; blocked_by: string[]; blocks: string[];
  created_at: number; updated_at: number;
}

export interface ActivityCursor { ts: number; id: string }

export interface ActivityPageItem {
  kind: 'message' | 'task';
  created_at: number;
  id: string;
  message?: TeamMailboxMessage;
  task?: TeamTask;
}

export interface ActivityPage {
  items: ActivityPageItem[];
  next_cursor?: ActivityCursor | null;
  has_more: boolean;
}

/** 没有对应成员的消息/任务落在这里，不丢条目。 */
export const FALLBACK_LANE = '__fallback__';
/** 信箱里代表用户/外部的固定身份。 */
export const USER_IDENTITY = 'user';
/** team_send_message 的广播收件人。 */
export const BROADCAST_TARGET = '*';

export const isBroadcastMessage = (m: TeamMailboxMessage) => m.to_agent_id === BROADCAST_TARGET;
export const isSystemMessageType = (type: string) => type === 'idle_notification' || type === 'shutdown_request';
export const isFinishedTaskStatus = (status: string) => status === 'completed' || status === 'deleted';

/** 消息进收件人列；广播没有单一收件人，进发件人列；其余落 fallback。 */
export function resolveMessageLane(m: TeamMailboxMessage, knownSlots: ReadonlySet<string>): string {
  const target = isBroadcastMessage(m) ? m.from_agent_id : m.to_agent_id;
  return target && target !== USER_IDENTITY && knownSlots.has(target) ? target : FALLBACK_LANE;
}

/** 任务进负责人的列；没有负责人或负责人已不在团队时落 fallback。 */
export function resolveTaskLane(task: TeamTask, knownSlots: ReadonlySet<string>): string {
  const owner = task.owner;
  return owner && owner !== USER_IDENTITY && knownSlots.has(owner) ? owner : FALLBACK_LANE;
}

export type ActivityItem =
  | { kind: 'phone'; id: string; lane: string; createdAt: number; phone: PhoneActivity }
  | { kind: 'message'; id: string; lane: string; createdAt: number; message: TeamMailboxMessage }
  | { kind: 'task'; id: string; lane: string; createdAt: number; task: TeamTask };

function toItem(page: ActivityPageItem, knownSlots: ReadonlySet<string>): ActivityItem | null {
  if (page.kind === 'message' && page.message) {
    return { kind: 'message', id: page.message.id, lane: resolveMessageLane(page.message, knownSlots), createdAt: page.message.created_at, message: page.message };
  }
  if (page.kind === 'task' && page.task) {
    return { kind: 'task', id: page.task.id, lane: resolveTaskLane(page.task, knownSlots), createdAt: page.task.created_at, task: page.task };
  }
  return null; // kind 与载荷不一致：调用方记录并跳过
}

/** 合并消息和任务，按 created_at 排序；同一时间用 id 保证顺序稳定。 */
export function buildActivityItems(
  messages: ReadonlyArray<TeamMailboxMessage>,
  tasks: ReadonlyArray<TeamTask>,
  knownSlots: ReadonlySet<string>,
  direction: ActivityDirection,
): ActivityItem[] {
  const items = [
    ...messages.map((m) => toItem({ kind: 'message' as const, created_at: m.created_at, id: m.id, message: m }, knownSlots)),
    ...tasks.map((task) => toItem({ kind: 'task' as const, created_at: task.created_at, id: task.id, task }, knownSlots)),
  ].filter((item): item is ActivityItem => item !== null);
  return sortActivityItems(items, direction);
}

export function sortActivityItems(items: ReadonlyArray<ActivityItem>, direction: ActivityDirection): ActivityItem[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return (a.createdAt - b.createdAt) * factor;
    return a.id < b.id ? -factor : a.id > b.id ? factor : 0;
  });
}

export interface ActivityFilter {
  /** 已经由服务端按 kind 取数；这里再判一次，切换瞬间也不会串类。 */
  kind: ActivityKind;
  /** 空集合 = 全部成员。 */
  members: ReadonlySet<string>;
  showSystemMessages: boolean;
  showFinishedTasks: boolean;
}

export function filterActivityItems(items: ReadonlyArray<ActivityItem>, filter: ActivityFilter): ActivityItem[] {
  return items.filter((item) => {
    const kind = item.kind === 'phone' ? item.phone.category : item.kind;
    if (filter.kind !== 'all' && kind !== filter.kind) return false;
    if (item.kind === 'phone' && !filter.showSystemMessages && item.phone.system) return false;
    if (item.kind === 'phone' && !filter.showFinishedTasks && item.phone.finished) return false;
    if (item.kind === 'message' && !filter.showSystemMessages && isSystemMessageType(item.message.msg_type)) return false;
    if (item.kind === 'task' && !filter.showFinishedTasks && isFinishedTaskStatus(item.task.status)) return false;
    if (filter.members.size > 0 && !filter.members.has(item.lane)) return false;
    return true;
  });
}

const LANE_COLORS = ['var(--brand)', 'var(--info)', 'var(--warn)', 'var(--online)', 'var(--crown)', 'var(--danger)'];

/** 成员的圆点颜色：同一 slot 始终同色，深色/亮色都从令牌取。 */
export function laneColor(slotId: string): string {
  if (!slotId) return 'var(--placeholder)';
  let hash = 0;
  for (let i = 0; i < slotId.length; i++) hash = (hash * 31 + slotId.charCodeAt(i)) >>> 0;
  return LANE_COLORS[hash % LANE_COLORS.length];
}
