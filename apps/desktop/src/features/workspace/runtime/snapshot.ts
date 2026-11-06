import { api } from '@/core/client';
import { basename } from '@/shared/lib/util';
import { update, S } from '@/state/store';
import type { SnapshotChange, SnapshotView } from '@/state/types';

/* ===== WS-SNAPSHOT-01：读取核心的文件快照（有 .git 用仓库，没有用影子快照），得到真实的新增 / 修改 / 删除 ===== */

interface CoreChange { file_path?: string; relative_path?: string; operation?: string }
interface CoreInfo { mode?: string; branch?: string | null }
interface CoreCompare { staged?: unknown; unstaged?: unknown }

const BAD_RESPONSE = 'workspace.snapshot_bad_response';
const OPERATIONS = new Set(['create', 'modify', 'delete']);

/** 已建好快照的文件夹 → 基线建立时间；不重复 init，也不改写基线时间 */
const baselines = new Map<string, number>();
let seq = 0;
export const resetSnapshot = () => { baselines.clear(); seq++; };

/** 工作文件夹太宽（用户主目录、文稿、桌面、下载、磁盘根）时，影子快照会把整个目录记入基线：先让用户确认 */
export function snapshotGuard(workspace: string): string {
  const path = workspace.replace(/[\\/]+$/, '');
  const home = S.homeDir.replace(/[\\/]+$/, '');
  const broad = !path || (home && (path === home || ['Documents', 'Desktop', 'Downloads'].some(d => path === `${home}/${d}` || path === `${home}\\${d}`)));
  return broad || /^[A-Za-z]:$/.test(path) ? `「${basename(workspace) || workspace}」范围很大，建立快照要记录里面所有文件` : '';
}

const fail = (code: string, message: string) => Object.assign(new Error(message), { code });

function rowsOf(value: unknown, which: string): CoreChange[] {
  if (!Array.isArray(value)) throw fail(BAD_RESPONSE, `核心返回的文件状态格式不对（${which}）`);
  return value as CoreChange[];
}

/** 暂存区和工作区的变更合并成一份：同一文件取工作区里较新的操作，并标出是否已暂存 */
export function mergeCompare(raw: CoreCompare): SnapshotChange[] {
  const byPath = new Map<string, SnapshotChange>();
  const put = (rows: CoreChange[], staged: boolean) => {
    for (const r of rows) {
      if (!r.file_path || !r.operation || !OPERATIONS.has(r.operation)) throw fail(BAD_RESPONSE, '核心返回的文件状态缺少路径或操作');
      const old = byPath.get(r.file_path);
      byPath.set(r.file_path, { path: r.file_path, relative: r.relative_path || r.file_path, operation: r.operation as SnapshotChange['operation'], staged: staged || !!old?.staged });
    }
  };
  put(rowsOf(raw.staged, 'staged'), true);
  put(rowsOf(raw.unstaged, 'unstaged'), false);
  return [...byPath.values()];
}

const set = (patch: Partial<SnapshotView> & { workspace: string }) => update(s => { s.snapshot = { changes: [], ...patch, status: patch.status ?? 'idle' }; });

export const hasBaseline = (workspace: string) => baselines.has(workspace);

export interface SnapshotRead { mode: 'git-repo' | 'snapshot'; branch: string | null; since?: number; changes: SnapshotChange[] }

/** init（核心对已初始化的文件夹幂等）后 compare；任何格式问题都抛出带错误码的错误 */
export async function readSnapshot(workspace: string): Promise<SnapshotRead> {
  const info = await api<CoreInfo>('POST', '/api/fs/snapshot/init', { workspace });
  if (info?.mode !== 'git-repo' && info?.mode !== 'snapshot') throw fail(BAD_RESPONSE, '核心没有说明快照模式');
  if (!baselines.has(workspace)) baselines.set(workspace, Date.now());
  const changes = mergeCompare(await api<CoreCompare>('POST', '/api/fs/snapshot/compare', { workspace }));
  return { mode: info.mode, branch: info.branch ?? null, since: info.mode === 'snapshot' ? baselines.get(workspace) : undefined, changes };
}

export async function refreshSnapshot(workspace: string, opts: { force?: boolean } = {}) {
  const mine = ++seq;
  if (!workspace) { set({ workspace, status: 'idle' }); return; }
  if (!opts.force && snapshotGuard(workspace) && !baselines.has(workspace)) { set({ workspace, status: 'guarded' }); return; }
  const keep = S.snapshot.workspace === workspace ? S.snapshot.changes : [];
  set({ workspace, status: 'loading', changes: keep, mode: S.snapshot.mode, branch: S.snapshot.branch, since: baselines.get(workspace) });
  try {
    const read = await readSnapshot(workspace);
    if (mine === seq) set({ workspace, status: 'ready', ...read });
  } catch (e) {
    console.warn('读取文件快照失败', workspace, e);
    if (mine === seq) set({ workspace, status: 'error', code: (e as { code?: string }).code, error: e instanceof Error ? e.message : String(e) });
  }
}
