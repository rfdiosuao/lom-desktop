import { conv } from '@/state/selectors';
import { S, update, watchStore } from '@/state/store';
import type { FileChange, Msg, SnapshotChange, TurnBase } from '@/state/types';
import { hasBaseline, readSnapshot, snapshotGuard } from './snapshot';
import { activeFolder } from './workspace';

/* ===== WS-SNAPSHOT-02：「本轮」口径。用户发送消息时记下文件状态，轮末与现在相减 =====
 * 核心的基线是 Git 提交或影子快照建立时刻，没有「本轮开始」的概念，所以由桌面端在发送时记一份。 */

/** 只处理刚发出的消息；打开旧会话、切换会话时看到的历史消息不触发 */
const FRESH_MS = 15_000;
const seen = new Set<string>();
let stop: (() => void) | null = null;

const lastUser = (messages: Msg[]) => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].type === 'user') return messages[i]; return undefined; };
const put = (convId: string, base: TurnBase) => update(s => { s.turnBase[convId] = base; });
const current = (convId: string, msgId: string) => S.turnBase[convId]?.msgId === msgId;

async function capture(convId: string, msgId: string, workspace: string) {
  const base: TurnBase = { msgId, workspace, at: Date.now(), status: 'pending', files: {} };
  put(convId, base);
  if (snapshotGuard(workspace) && !hasBaseline(workspace)) { put(convId, { ...base, status: 'skipped' }); return; }
  try {
    const read = await readSnapshot(workspace);
    if (current(convId, msgId)) put(convId, { ...base, status: 'ready', files: Object.fromEntries(read.changes.map(c => [c.path, c.operation])) });
  } catch (e) {
    console.warn('记录本轮开始时的文件状态失败', workspace, e);
    if (current(convId, msgId)) put(convId, { ...base, status: 'failed', code: (e as { code?: string }).code, error: e instanceof Error ? e.message : String(e) });
  }
}

function check() {
  if (S.route.name !== 'chat') return;
  const c = conv(S.activeConv), last = c && lastUser(c.messages);
  if (!c || !last || seen.has(last.id)) return;
  seen.add(last.id);
  const workspace = activeFolder();
  if (workspace && Date.now() - last.at <= FRESH_MS) void capture(c.id, last.id, workspace);
}

export function startTurnBaseline() { stopTurnBaseline(); stop = watchStore(check); }
export function stopTurnBaseline() { stop?.(); stop = null; seen.clear(); }

const matches = (c: SnapshotChange, path: string) => c.relative === path || c.path === path || c.path.endsWith(`/${path}`) || c.path.endsWith(`\\${path}`);

/** 本轮变更 = 和发送时相比状态变了的文件；状态没变但本轮工具调用写过的文件也算（例如已修改的文件又被改） */
export function turnChangesFromBase(now: SnapshotChange[], base: TurnBase, written: FileChange[]): SnapshotChange[] {
  return now.filter(c => base.files[c.path] !== c.operation || written.some(w => matches(c, w.path)));
}
