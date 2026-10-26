import type { TeamMailboxMessage, TeamTask } from './activityTypes';

/* D33 实时事件桥：stream.ts 收到内核事件后交给这里，看板按团队订阅。
 * 事件形状不对时只记录并忽略，不构造假条目。 */

export type ActivityEvent =
  | { type: 'mailbox'; teamId: string; message: TeamMailboxMessage }
  | { type: 'task'; teamId: string; task: TeamTask };

type Listener = (event: ActivityEvent) => void;
const listeners = new Set<Listener>();
const reconnectListeners = new Set<() => void>();

export function subscribeActivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 断线重连后看板要补上断线期间的事件：重新拉第一页。 */
export function subscribeActivityReconnect(listener: () => void): () => void {
  reconnectListeners.add(listener);
  return () => { reconnectListeners.delete(listener); };
}

export function emitActivityReconnect(): void {
  reconnectListeners.forEach((listener) => listener());
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []);

function asMessage(raw: unknown): TeamMailboxMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (!text(m.id) || !text(m.from_agent_id) || !text(m.to_agent_id)) return null;
  return {
    id: text(m.id), team_id: text(m.team_id), from_agent_id: text(m.from_agent_id), to_agent_id: text(m.to_agent_id),
    msg_type: text(m.msg_type), content: text(m.content), summary: typeof m.summary === 'string' ? m.summary : null,
    files: strings(m.files), read: m.read === true, created_at: num(m.created_at),
  };
}

function asTask(raw: unknown): TeamTask | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (!text(t.id) || !text(t.subject)) return null;
  return {
    id: text(t.id), team_id: text(t.team_id), subject: text(t.subject),
    description: typeof t.description === 'string' ? t.description : null,
    status: text(t.status), owner: typeof t.owner === 'string' && t.owner ? t.owner : null,
    blocked_by: strings(t.blocked_by), blocks: strings(t.blocks),
    created_at: num(t.created_at), updated_at: num(t.updated_at),
  };
}

/** handleCoreEvent 的入口：未知/残缺事件不进入看板。 */
export function emitActivityEvent(name: string, data: Record<string, unknown>): void {
  const teamId = text(data.team_id);
  if (!teamId) {
    console.warn('team.activity_event_ignored', name, '缺少 team_id');
    return;
  }
  if (name === 'team.mailboxChanged') {
    const message = asMessage(data.message);
    if (!message) {
      console.warn('team.activity_event_ignored', name, '消息字段不完整');
      return;
    }
    listeners.forEach((listener) => listener({ type: 'mailbox', teamId, message }));
    return;
  }
  if (name === 'team.taskChanged') {
    const task = asTask(data.task);
    if (!task) {
      console.warn('team.activity_event_ignored', name, '任务字段不完整');
      return;
    }
    listeners.forEach((listener) => listener({ type: 'task', teamId, task }));
  }
}
