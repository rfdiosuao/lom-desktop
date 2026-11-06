import { toast, toastError } from '@/shared/overlays/controller';
import { conv } from '@/state/selectors';
import { S } from '@/state/store';

/* ===== WS-REQUIRED-01：会话开始工作前必须先有工作区 =====
 * 工作区只来自用户的选择：输入框上选中的文件夹（上次用过的会被记住并显示出来），或会话自己记录的文件夹。
 * 不再悄悄落到核心的默认目录或临时目录。 */

export const WS_REQUIRED = 'workspace.required';
export const WS_UNSET = 'workspace.unset';
export const WS_FILE_MISSING = 'workspace.file_missing';
export const WS_FILE_OUTSIDE = 'workspace.file_outside';
export const WS_PREVIEW_FAILED = 'workspace.preview_failed';

/** 带错误码的错误：错误码写在文案末尾，弹窗里也看得到 */
export class WorkspaceError extends Error {
  constructor(public code: string, text: string) { super(`${text}（${code}）`); this.name = 'WorkspaceError'; }
}
export const workspaceError = (code: string, text: string) => new WorkspaceError(code, text);

export const workspaceRequired = (subject = '') =>
  workspaceError(WS_REQUIRED, `${subject}还没有工作区，请先选择一个工作文件夹，AI 才知道在哪里工作`);

export type WorkspaceState = { path: string; kind: 'set' | 'missing' | 'legacy' };

/** 输入框 key 对应的工作区：首页是「新任务将使用的文件夹」，电脑任务是会话自己记录的文件夹 */
export function workspaceState(ckey: string): WorkspaceState | null {
  if (ckey === 'home') return S.mode === 'desktop' ? { path: S.folder, kind: S.folder ? 'set' : 'missing' } : null;
  const c = ckey.startsWith('conv:') ? conv(ckey.slice(5)) : undefined;
  if (!c?.remote || c.sideOf || c.phoneSession) return null;
  return { path: c.workspace || '', kind: c.workspace ? 'set' : 'legacy' };
}

/** 只有新任务必须先选；旧会话没记录工作区时可以继续用，界面提示补选 */
export const mustPickWorkspace = (ckey: string) => workspaceState(ckey)?.kind === 'missing';

/** 派发 / 团队 / 子任务：必须明确给出工作区，不回退到输入框默认值；首页新任务才使用输入框上的文件夹 */
export function taskFolder(o: { folder?: string; parent?: string; team?: string }): string {
  const folder = o.folder || (o.parent || o.team ? '' : S.folder);
  if (!folder) throw workspaceRequired(o.parent || o.team ? '派发的会话' : '这个任务');
  return folder;
}

/** 创建会话入口用：没有工作区就提示（带错误码）并返回空 */
export function folderOrNotify(o: Parameters<typeof taskFolder>[0]): string | null {
  try { return taskFolder(o); } catch (e) { toastError('未创建任务', e); return null; }
}

/** 发送前确认工作区。没有就直接弹出系统文件夹选择框；用户没选就不发送 */
export async function ensureWorkspace(ckey: string, pick: (ckey: string) => Promise<void>): Promise<boolean> {
  if (!mustPickWorkspace(ckey)) return true;
  toast('先选择工作区，AI 才知道在哪个文件夹里干活', 'folder');
  await pick(ckey);
  return !mustPickWorkspace(ckey);
}

const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR', 'NOT_FOUND', 'FILE_NOT_FOUND', 'PATH_NOT_FOUND', 'HTTP_404', WS_FILE_MISSING.toUpperCase()]);
/** 路径不存在。先看错误码和 HTTP 状态；核心只给系统原文时，再认 Unix（os error 2）、Windows（os error 3）和中文系统的提示 */
export function isMissingError(e: unknown): boolean {
  const { code, status } = (e ?? {}) as { code?: unknown; status?: unknown };
  if (status === 404 || MISSING_CODES.has(String(code ?? '').toUpperCase())) return true;
  const text = e instanceof Error ? e.message : String(e);
  return /os error (?:2|3)\b|ENOENT|No such file or directory|cannot find the (?:path|file)|系统找不到指定的(?:路径|文件)|文件不存在/i.test(text);
}

/** 打不开文件时说清楚原因和位置，一律带错误码（不显示成空文件或原始英文）；系统原文只进日志 */
export function openFailure(path: string, workspace: string, e: unknown): WorkspaceError {
  if (e instanceof WorkspaceError && e.code === WS_FILE_MISSING) return e;
  if (isMissingError(e)) return workspaceError(WS_FILE_MISSING, `这个文件（或文件夹）还不存在：${path}。可能还没有生成，或已被移动、删除`);
  const code = (e as { code?: unknown } | null)?.code;
  const text = e instanceof Error ? e.message : String(e);
  if (code === 'PATH_OUTSIDE_SANDBOX' || /outside the allowed sandbox/i.test(text))
    return workspaceError(WS_FILE_OUTSIDE, `文件在工作区之外：${path}${workspace ? `（当前工作区：${workspace}）` : ''}。AI 把它写到了别的目录，可以用「在文件夹中显示」找到它`);
  if (/没有工作目录/.test(text)) return workspaceError(WS_UNSET, `这条会话没有记录工作区，无法定位 ${path}。请先在输入框上方选择工作区`);
  console.warn('打开文件失败', path, e);
  // 核心自己的连接类错误本身就是写给用户看的中文，保留；其它系统原文不显示
  const shown = typeof code === 'string' && code.startsWith('LOM_CORE_') ? `：${text}` : '';
  return workspaceError(typeof code === 'string' && code ? code : 'workspace.open_failed', `无法打开 ${path}${shown}`);
}

/** 消息里的路径按钮提示：落在工作区之外的要如实写出来，而不是显示成普通可点文件 */
export function pathTitle(path: string, workspace?: string): string {
  const root = (workspace || '').replace(/[\\/]+$/, '');
  const outside = !!root && /^([a-z]:)?[\\/]/i.test(path) && !path.replace(/\\/g, '/').startsWith(`${root.replace(/\\/g, '/')}/`);
  return outside ? `在侧栏打开：${path}（在工作区之外，位置如实显示）` : `在侧栏打开：${path}`;
}

/** 预览刷新失败（WS-PREVIEW-01）：说清楚是哪个文件、什么原因，一律带错误码；已有错误码的保留原码 */
export function previewFailure(file: string, e: unknown): WorkspaceError {
  const code = (e as { code?: unknown } | null)?.code;
  const text = e instanceof Error ? e.message : String(e);
  return workspaceError(typeof code === 'string' && code ? code : WS_PREVIEW_FAILED, `预览刷新失败：无法读取 ${file}：${text}`);
}
