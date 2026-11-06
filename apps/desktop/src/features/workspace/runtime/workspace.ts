import { resolveLocalPath } from '@/shared/lib/localPaths';
import { conv, team } from '@/state/selectors';
import { teamFolder } from '@/features/teams/runtime/team';
import { S, update } from '@/state/store';
import type { Conv, FileNode, OpenFileInfo } from '@/state/types';
import { basename, relativeInside } from '@/shared/lib/util';
import { api, getEndpoint } from '@/core/client';
import { authRevision } from '@/features/account/runtime/authScope';
import { clipPreview, kindOf, looksBinary, READ_MAX_BYTES, TREE_MAX_NODES } from './fileKind';
import { isMissingError, openFailure, previewFailure, workspaceError, WS_FILE_MISSING } from './required';
import { inlineAssets } from './previewAssets';

/* ===== 工作文件夹：文件树、读取文件、预览、在系统中打开 ===== */

/** 当前工作区对应的文件夹：打开的电脑任务用它自己的文件夹；团队页用团队共享的文件夹（D33-UX-03，成员写的文件在这里）；
 *  否则用输入框上选中的文件夹 */
/** 不含临时浏览目录的工作区根 */
export const baseFolder = () => {
  const t = S.route.name === 'team' ? team(S.route.id) : undefined;
  if (t) return teamFolder(t);
  const c = S.route.name === 'chat' ? conv(S.activeConv) : undefined;
  // 旧会话没记录工作区时不猜目录（WS-REQUIRED-01）：文件面板提示补选
  if (c?.remote) return c.workspace || '';
  return S.folder;
};
/** 当前工作目录：只有「点了工作区之外的文件夹」才临时换成那个文件夹（文件页工具栏有「返回工作区」） */
export const activeFolder = () => S.workspaceBrowseRoot || baseFolder();

/** 默认隐藏的依赖和系统条目；dist、build、target 等产物目录照常显示（WS-TREE-01 #405） */
const IGNORED = new Set(['node_modules', '.git', '.DS_Store', '.venv', '__pycache__']);

/** /api/fs/dir 返回的嵌套目录（不走缓存，Agent 用工具写入的文件也能立刻看到） */
interface DirEntry { name: string; full_path: string; is_dir: boolean; children?: DirEntry[]; }

/** 文件夹在前，同类按名称排序；依赖目录默认不显示但会计数；总条目超过上限的部分不再生成，并计数 */
export const buildTree = (root: string, entries: DirEntry[], showAll = false): FileNode => {
  const stat = { hidden: 0, omitted: 0, count: 0 };
  const toNode = (e: DirEntry): FileNode => ({
    name: e.name, path: e.full_path, type: e.is_dir ? 'dir' : 'file',
    ...(e.is_dir ? { children: kids(e.children) } : {}),
  });
  const kids = (list: DirEntry[] = []): FileNode[] => {
    const shown = list.filter(c => { const hide = !showAll && IGNORED.has(c.name); if (hide) stat.hidden++; return !hide; })
      .sort((a, b) => (a.is_dir === b.is_dir ? a.name.localeCompare(b.name, 'zh-CN') : a.is_dir ? -1 : 1));
    const out: FileNode[] = [];
    for (const e of shown) { if (stat.count >= TREE_MAX_NODES) { stat.omitted++; continue; } stat.count++; out.push(toNode(e)); }
    return out;
  };
  const children = kids(entries);
  return { name: basename(root), path: root, type: 'dir', children, ...(stat.hidden ? { hidden: stat.hidden } : {}), ...(stat.omitted ? { omitted: stat.omitted } : {}) };
};

/** 文件夹还没建出来时的提示开头；界面据此显示「还没有文件」而不是「读取失败」 */
export const MISSING_FOLDER = '这个文件夹还不存在';

let refreshing: Promise<void> | null = null;
let again = false;
let treeRoot: string | undefined;

async function doRefresh() {
  const root = activeFolder();
  // 换了文件夹：旧树、旧错误立刻清掉；没有工作目录时清空并提示选择，不留着上一个任务的内容（WS-PATH-01 #407）
  update(s => {
    if (treeRoot !== root) s.filesError = '';
    treeRoot = root;
    if (s.files && s.files.path !== root) s.files = null;
    if (!root) { s.files = null; s.filesError = ''; }
    s.filesLoading = !!root && !!getEndpoint();
  });
  if (!root || !getEndpoint()) return;
  try {
    const entries = await api<DirEntry[]>('POST', '/api/fs/dir', { dir: root, root });
    update(s => {
      if (activeFolder() !== root) return;
      s.files = buildTree(root, entries, s.filesShowAll);
      s.treeOpen[root] = s.treeOpen[root] ?? true;
      s.filesError = '';
    });
  } catch (e) {
    // 文件夹还没建出来（例如团队还没开工）不是故障：说清楚；其它错误带错误码，系统原文只进日志
    const missing = isMissingError(e), code = (e as { code?: unknown } | null)?.code;
    if (!missing) console.warn('读取文件夹失败', root, e);
    const text = missing ? `${MISSING_FOLDER}：${root}。开始工作后生成的文件会出现在这里。`
      : workspaceError(typeof code === 'string' && code ? code : 'workspace.list_failed', `没能读取这个文件夹：${root}`).message;
    update(s => { if (activeFolder() !== root) return; s.files = null; s.filesError = text; });
  } finally {
    update(s => { s.filesLoading = false; });
  }
  await refreshPreview();
}

/** 当前工作目录的文件树已经读过：切换标签不必重扫（写文件、手动刷新、换文件夹才重新读取） */
export const treeIsCurrent = () => !!S.files && S.files.path === activeFolder() && !S.filesError;

/** 显示 / 隐藏依赖与系统条目，并按新设置重建文件树 */
export function setShowAllFiles(value: boolean) {
  update(s => { s.filesShowAll = value; });
  return refreshWorkspace();
}

/** 刷新文件树和预览。进行中再次调用时，等这一轮结束后按最新的路由再刷一次（避免拿到旧文件夹的结果） */
export function refreshWorkspace(): Promise<void> {
  if (refreshing) { again = true; return refreshing; }
  refreshing = (async () => {
    do { again = false; await doRefresh(); } while (again);
  })().finally(() => { refreshing = null; });
  return refreshing;
}

const readAt = (path: string, workspace: string) => api<string>('POST', '/api/fs/read', { path, workspace: workspace || undefined });
export const readText = (path: string) => readAt(path, activeFolder());

const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '');

let previewSelection = 0;
let previewOwner: { conversation?: Conv; file?: string; workspace: string; account?: string; auth: () => boolean } | undefined;
export async function refreshPreview() {
  const selection = ++previewSelection;
  const c = S.route.name === 'chat' ? conv(S.activeConv) : undefined;
  const file = c?.remote ? c.previewFile : undefined;
  const workspace = activeFolder(), account = S.account?.id, auth = authRevision();
  if (!file || !previewOwner?.auth() || previewOwner.conversation !== c || previewOwner.file !== file || previewOwner.workspace !== workspace || previewOwner.account !== account)
    update(s => { s.previewHtml = ''; s.previewError = ''; s.previewAssetFailures = []; s.previewAssetTotal = 0; });
  previewOwner = { conversation: c, file, workspace, account, auth };
  if (!file || !c) return;
  const current = () => selection === previewSelection && S.route.name === 'chat' && S.activeConv === c.id
    && conv(c.id) === c && c.previewFile === file && activeFolder() === workspace && S.account?.id === account && auth();
  try {
    const page = await inlineAssets(await readAt(file, workspace), file, workspace, readAt);
    if (current()) update(s => { s.previewHtml = page.html; s.previewAt = Date.now(); s.previewError = ''; s.previewAssetFailures = page.failures; s.previewAssetTotal = page.total; });
  } catch (e) {
    // 刷新失败：保留上一次成功的内容和它的时间（previewAt 不动），错误带错误码展示，界面不能再写「已更新」（WS-PREVIEW-01 #401）
    if (current()) update(s => { s.previewError = previewFailure(file, e).message; });
  }
}

/** 核心报告的文件大小；查不到不影响打开（读取本身会报真正的错误） */
async function sizeOf(path: string, workspace: string): Promise<number | undefined> {
  try {
    const meta = await api<{ size?: unknown } | null>('POST', '/api/fs/metadata', { path, workspace: workspace || undefined });
    return typeof meta?.size === 'number' ? meta.size : undefined;
  } catch (e) { console.warn('读取文件大小失败', path, e); return undefined; }
}

/** readRoot：读取时使用的工作区；工作区之外的文件只对这一次读取放行，不改变当前工作目录。
 *  二进制文件（按扩展名，未知扩展名再嗅探内容）和过大的文件不读取正文；长文本截断并提示（WS-TREE-01 #400 #408） */
export async function openFile(path: string | null, readRoot?: string) {
  if (!path) { update(s => { s.openFile = null; s.openFileContent = ''; s.openFileError = ''; s.openFileInfo = null; }); return; }
  update(s => { s.openFile = path; s.openFileContent = ''; s.openFileError = ''; s.openFileInfo = null; });
  const root = readRoot ?? activeFolder();
  const show = (content: string, info: OpenFileInfo) => update(s => { if (s.openFile === path) { s.openFileContent = content; s.openFileInfo = info; } });
  try {
    const size = await sizeOf(path, root);
    if (kindOf(path) === 'binary') return show('', { kind: 'binary', size });
    if (size !== undefined && size > READ_MAX_BYTES) return show('', { kind: 'large', size });
    const text = await readAt(path, root);
    // 核心对不存在的文件返回 null；这不是空文件，要如实告诉用户（WS-REQUIRED-01）
    if (text === null || text === undefined) throw workspaceError(WS_FILE_MISSING, `找不到这个文件：${path}。它可能已被移动或删除，也可能写在了工作区以外`);
    if (looksBinary(text)) return show('', { kind: 'binary', size });
    const { shown, truncated } = clipPreview(text);
    show(shown || '（空文件）', { kind: 'text', size, truncated });
  } catch (e) {
    const failure = openFailure(path, root, e);
    update(s => { if (s.openFile === path) { s.openFileContent = ''; s.openFileError = failure.message; } });
  }
}

/** 用系统默认应用打开文件 / 在访达（资源管理器）中显示；核心的 open-file 只接受文件，文件夹走 open-folder-with（WS-OPEN-FOLDER-01） */
const shell = (route: string, body: Record<string, unknown>, path: string, what: string) => api('POST', route, body).catch((e: unknown) => {
  console.warn('系统打开失败', path, e);
  throw workspaceError('workspace.shell_failed', `没能${what}，${what.includes('文件夹') ? '文件夹' : '文件'}可能不存在或已被移动`);
});
export const openInSystem = (path: string) => shell('/api/shell/open-file', { file_path: path }, path, '用系统应用打开');
export const revealInSystem = (path: string) => shell('/api/shell/show-item-in-folder', { file_path: path }, path, '在文件夹中显示');
/** 在系统文件管理器里打开文件夹本身 */
export const openFolderInSystem = (path: string) => shell('/api/shell/open-folder-with', { folder_path: path, tool: 'explorer' }, path, '在文件管理器中打开文件夹');

/** 把 root 到 target 之间的每一级目录在文件树里展开（target 是文件时不含它自己） */
function revealInTree(root: string, target: string, isDir: boolean) {
  const rel = relativeInside(target, root);
  if (!rel) return;
  const parts = rel.split(/[\\/]/).filter(Boolean), sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  let at = root.replace(/[\\/]+$/, '');
  update(s => { for (const part of isDir ? parts : parts.slice(0, -1)) { at += sep + part; s.treeOpen[at] = true; } });
}

let pathSelection = 0;
/** An explicit user click opens a read-only local preview, never a shell command.
 *  工作区之内的文件 / 文件夹：只在树里展开定位，不换工作区根（WS-PATH-01 #399）；
 *  工作区之外的文件：单独读取；工作区之外的文件夹：临时浏览，文件页工具栏有「返回工作区」。 */
export async function openMessagePath(source: string, workspace?: string) {
  const selection = ++pathSelection;
  const route = S.route, conversation = S.activeConv, account = S.account;
  const current = () => selection === pathSelection && S.route === route && S.activeConv === conversation && S.account === account;
  let path = source;
  update(s => { s.layout.rightCollapsed = false; s.wsTab = 'files'; s.openFile = null; s.openFileContent = ''; s.openFileError = ''; s.filesError = ''; s.filesLoading = true; });
  try {
    path = resolveLocalPath(source, workspace || '', S.homeDir || getEndpoint()?.homeDir || '');
    const parent = dirOf(path) || '/';
    const meta = await api<{ is_directory?: boolean }>('POST', '/api/fs/metadata', { path, workspace: parent });
    if (!current()) return;
    const inBase = relativeInside(path, baseFolder()) !== null, inActive = relativeInside(path, activeFolder()) !== null;
    update(s => { s.workspaceBrowseRoot = inBase ? '' : meta.is_directory && !inActive ? path : s.workspaceBrowseRoot; });
    await refreshWorkspace();
    if (!current()) return;
    revealInTree(activeFolder(), path, !!meta.is_directory);
    if (!meta.is_directory) await openFile(path, relativeInside(path, activeFolder()) === null ? parent : undefined);
  } catch (e) {
    // 找不到文件不是「文件夹读取失败」：错误显示在阅读区，文件树保持原样
    if (current()) { const failure = openFailure(path, workspace || '', e); update(s => { s.openFile = path; s.openFileError = failure.message; }); }
  } finally { if (current()) update(s => { s.filesLoading = false; }); }
}

/** 退出临时浏览，回到工作区根 */
export function backToWorkspace() {
  update(s => { s.workspaceBrowseRoot = ''; });
  void refreshWorkspace();
}
