import { resolveLocalPath } from '@/shared/lib/localPaths';
import { conv, team } from '@/state/selectors';
import { teamFolder } from '@/features/teams/runtime/team';
import { S, update } from '@/state/store';
import type { Conv, FileNode } from '@/state/types';
import { basename } from '@/shared/lib/util';
import { api, getEndpoint } from '@/core/client';
import { authRevision } from '@/features/account/runtime/authScope';

/* ===== 工作文件夹：文件树、读取文件、预览、在系统中打开 ===== */

/** 当前工作区对应的文件夹：打开的电脑任务用它自己的文件夹；团队页用团队共享的文件夹（D33-UX-03，成员写的文件在这里）；
 *  否则用输入框上选中的文件夹 */
export const activeFolder = () => {
  if (S.workspaceBrowseRoot) return S.workspaceBrowseRoot;
  const t = S.route.name === 'team' ? team(S.route.id) : undefined;
  if (t) return teamFolder(t);
  const c = S.route.name === 'chat' ? conv(S.activeConv) : undefined;
  if (c?.remote && c.workspace) return c.workspace;
  return S.folder || getEndpoint()?.defaultFolder || '';
};

const IGNORED = new Set(['node_modules', '.git', '.DS_Store', 'dist', 'target', '.venv', '__pycache__']);

/** /api/fs/dir 返回的嵌套目录（不走缓存，Agent 用工具写入的文件也能立刻看到） */
interface DirEntry { name: string; full_path: string; is_dir: boolean; children?: DirEntry[]; }

/** 文件夹在前，同类按名称排序；依赖和构建目录不显示 */
const children = (list: DirEntry[] = []): FileNode[] => list
  .filter(c => !IGNORED.has(c.name))
  .sort((a, b) => (a.is_dir === b.is_dir ? a.name.localeCompare(b.name, 'zh-CN') : a.is_dir ? -1 : 1))
  .map(toNode);

const toNode = (e: DirEntry): FileNode => ({
  name: e.name, path: e.full_path, type: e.is_dir ? 'dir' : 'file',
  ...(e.is_dir ? { children: children(e.children) } : {}),
});

export const buildTree = (root: string, entries: DirEntry[]): FileNode =>
  ({ name: basename(root), path: root, type: 'dir', children: children(entries) });

/** 文件夹还没建出来时的提示开头；界面据此显示「还没有文件」而不是「读取失败」 */
export const MISSING_FOLDER = '这个文件夹还不存在';

let refreshing: Promise<void> | null = null;
let again = false;

async function doRefresh() {
  const root = activeFolder();
  if (!root || !getEndpoint()) return;
  update(s => { s.filesLoading = true; });
  try {
    const entries = await api<DirEntry[]>('POST', '/api/fs/dir', { dir: root, root });
    update(s => {
      if (activeFolder() !== root) return;
      s.files = buildTree(root, entries);
      s.treeOpen[root] = s.treeOpen[root] ?? true;
      s.filesError = '';
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // 文件夹还没建出来（例如团队还没开工）不是故障：说清楚，不把系统原始报错甩给用户
    const missing = /No such file or directory|os error 2|cannot find the path/i.test(message);
    update(s => { if (activeFolder() !== root) return; s.files = null; s.filesError = missing ? `${MISSING_FOLDER}：${root}。开始工作后生成的文件会出现在这里。` : message; });
  } finally {
    update(s => { s.filesLoading = false; });
  }
  await refreshPreview();
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
const isRelative = (u: string) => !!u && !/^(?:[a-z]+:|\/\/|#|\/)/i.test(u);
/** 单个资源内联失败时保留原引用（预览里该资源缺失），并在控制台记录原因 */
const keep = (ref: string) => (e: unknown) => console.warn('预览：无法内联本地资源，保留原引用', ref, e);

/** 把页面引用的本地样式、脚本、图片内联进来。
 * 预览在 sandbox iframe 里运行，页面拿不到启动令牌，也访问不到 Lom 的界面。 */
async function inlineAssets(html: string, file: string, workspace: string) {
  const dir = dirOf(file);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const jobs: Promise<void>[] = [];
  doc.querySelectorAll('link[rel="stylesheet"][href]').forEach(el => {
    const href = el.getAttribute('href') || '';
    if (!isRelative(href)) return;
    jobs.push(readAt(`${dir}/${href}`, workspace).then(css => { const st = doc.createElement('style'); st.textContent = css; el.replaceWith(st); }).catch(keep(href)));
  });
  doc.querySelectorAll('script[src]').forEach(el => {
    const src = el.getAttribute('src') || '';
    if (!isRelative(src)) return;
    jobs.push(readAt(`${dir}/${src}`, workspace).then(js => { el.removeAttribute('src'); el.textContent = js; }).catch(keep(src)));
  });
  doc.querySelectorAll('img[src]').forEach(el => {
    const src = el.getAttribute('src') || '';
    if (!isRelative(src)) return;
    jobs.push(api<string>('POST', '/api/fs/image-base64', { path: `${dir}/${src}`, workspace }).then(data => { el.setAttribute('src', data); }).catch(keep(src)));
  });
  await Promise.all(jobs);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

let previewSelection = 0;
let previewOwner: { conversation?: Conv; file?: string; workspace: string; account?: string; auth: () => boolean } | undefined;
export async function refreshPreview() {
  const selection = ++previewSelection;
  const c = S.route.name === 'chat' ? conv(S.activeConv) : undefined;
  const file = c?.remote ? c.previewFile : undefined;
  const workspace = activeFolder(), account = S.account?.id, auth = authRevision();
  if (!file || !previewOwner?.auth() || previewOwner.conversation !== c || previewOwner.file !== file || previewOwner.workspace !== workspace || previewOwner.account !== account)
    update(s => { s.previewHtml = ''; s.previewError = ''; });
  previewOwner = { conversation: c, file, workspace, account, auth };
  if (!file || !c) return;
  const current = () => selection === previewSelection && S.route.name === 'chat' && S.activeConv === c.id
    && conv(c.id) === c && c.previewFile === file && activeFolder() === workspace && S.account?.id === account && auth();
  try {
    const html = await inlineAssets(await readAt(file, workspace), file, workspace);
    if (current()) update(s => { s.previewHtml = html; s.previewAt = Date.now(); s.previewError = ''; });
  } catch (e) {
    if (current()) update(s => { s.previewError = e instanceof Error ? e.message : String(e); });
  }
}

export async function openFile(path: string | null) {
  if (!path) { update(s => { s.openFile = null; s.openFileContent = ''; }); return; }
  update(s => { s.openFile = path; s.openFileContent = ''; });
  try {
    const text = /\.(png|jpe?g|gif|webp|svg|ico|mp4|mov|pdf|zip)$/i.test(path) ? '（二进制文件，无法预览）' : await readText(path);
    update(s => { if (s.openFile === path) s.openFileContent = text || '（空文件）'; });
  } catch (e) {
    update(s => { if (s.openFile === path) s.openFileContent = `读取失败：${e instanceof Error ? e.message : String(e)}`; });
  }
}

/** 用系统默认应用打开 / 在访达（资源管理器）中显示 */
export const openInSystem = (path: string) => api('POST', '/api/shell/open-file', { file_path: path });
export const revealInSystem = (path: string) => api('POST', '/api/shell/show-item-in-folder', { file_path: path });

let pathSelection = 0;
/** An explicit user click opens a read-only local preview, never a shell command. */
export async function openMessagePath(source: string, workspace?: string) {
  const selection = ++pathSelection;
  const route = S.route, conversation = S.activeConv, account = S.account;
  const current = () => selection === pathSelection && S.route === route && S.activeConv === conversation && S.account === account;
  let path = source;
  update(s => { s.layout.rightCollapsed = false; s.wsTab = 'files'; s.openFile = null; s.files = null; s.filesError = ''; s.filesLoading = true; });
  try {
    path = resolveLocalPath(source, workspace || S.folder || getEndpoint()?.defaultFolder || '', S.homeDir || getEndpoint()?.homeDir || '');
    const parent = dirOf(path) || '/';
    const meta = await api<{ is_directory?: boolean }>('POST', '/api/fs/metadata', { path, workspace: parent });
    if (!current()) return;
    update(s => { s.workspaceBrowseRoot = meta.is_directory ? path : parent; });
    await refreshWorkspace();
    if (current() && !meta.is_directory) await openFile(path);
  } catch (e) {
    if (current()) update(s => { s.filesError = `无法打开 ${path}：${e instanceof Error ? e.message : String(e)}`; });
  } finally { if (current()) update(s => { s.filesLoading = false; }); }
}
