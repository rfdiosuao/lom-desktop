import { useState } from 'react';
import { fileManagerName } from '@/core/platform';
import { Btn, Dropdown, IconBtn } from '@/shared/ui/Button';
import { Spinner } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { Empty } from '@/shared/ui/Layout';
import { toast, toastError } from '@/shared/overlays/controller';
import { cx, prettyPath } from '@/shared/lib/util';
import { conv } from '@/state/selectors';
import { update, useStore } from '@/state/store';
import type { FileNode } from '@/state/types';
import { iconOf, TREE_MAX_NODES } from '../runtime/fileKind';
import { activeFolder, backToWorkspace, baseFolder, MISSING_FOLDER, openFile, refreshWorkspace, setShowAllFiles } from '../runtime/workspace';
import { FileReading } from './FileReading';
import { OpenFolderButton } from './OpenFolderButton';
import './workspaceFiles.css';

function matches(node: FileNode, query: string): boolean {
  return node.name.toLocaleLowerCase().includes(query) || !!node.children?.some(child => matches(child, query));
}
function Tree({ node, query, depth = 0 }: { node: FileNode; query: string; depth?: number }) {
  const s = useStore();
  if (query && !matches(node, query)) return null;
  const folder = node.type === 'dir', open = !!query || !!s.treeOpen[node.path];
  const selected = s.openFile === node.path;
  const icon = folder ? 'folder' : iconOf(node.name);
  const childQuery = node.name.toLocaleLowerCase().includes(query) ? '' : query;
  return <>
    <button type="button" className={cx('ftree__row', selected && 'is-active')} title={node.path}
      aria-expanded={folder ? open : undefined} aria-current={selected ? 'true' : undefined}
      style={{ paddingLeft: (folder ? 6 : 24) + depth * 14 }}
      onClick={() => folder ? update(x => { x.treeOpen[node.path] = !open; }) : void openFile(node.path)}>
      {folder && <Icon name="chevron" className={`caret ${open ? '' : 'is-closed'}`} />}
      <Icon name={icon} /><span className="grow ellipsis">{node.name}</span>
    </button>
    {folder && open && node.children?.map(child => <Tree key={child.path} node={child} query={childQuery} depth={depth + 1} />)}
  </>;
}
/** 树底部：隐藏了多少依赖 / 系统条目（可以显示）、超过上限没显示的数量 */
function TreeNotes({ tree, showAll }: { tree: FileNode; showAll: boolean }) {
  const toggle = (value: boolean) => void setShowAllFiles(value).catch(e => toastError('刷新失败', e));
  return <>
    {!!tree.hidden && <p className="file-browser__note" role="status">已隐藏 {tree.hidden} 项（node_modules、.git 等依赖与系统项）<Btn label="显示" variant="link" size="sm" onClick={() => toggle(true)} /></p>}
    {showAll && <p className="file-browser__note" role="status">正在显示依赖与系统项<Btn label="隐藏" variant="link" size="sm" onClick={() => toggle(false)} /></p>}
    {!!tree.omitted && <p className="file-browser__note" role="status">目录太大，只显示前 {TREE_MAX_NODES} 项，另有 {tree.omitted} 项未列出。可以用上方筛选或在{fileManagerName() || '文件管理器'}中查看</p>}
  </>;
}
export function WsFiles() {
  const s = useStore(), root = activeFolder();
  const [filter, setFilter] = useState({ root, text: '' });
  const query = filter.root === root ? filter.text : '';
  const normalized = query.trim().toLocaleLowerCase();
  const tree = s.files && s.files.path === root ? s.files : null;   // 只显示属于当前根的树，换文件夹后不残留旧内容
  const browsing = !!s.workspaceBrowseRoot && s.workspaceBrowseRoot !== baseFolder();
  const inTask = s.route.name === 'chat' && !!conv(s.activeConv)?.remote;
  return <div className="workspace-files">
    <div className="workspace-files__toolbar">
      <Dropdown label={root ? prettyPath(root, s.homeDir) : '选择文件夹'} ic="folder" menu="folder" variant="secondary" size="sm" title={inTask ? `这个任务的工作文件夹：${root}` : root}
        className="btn--path" ctx={inTask ? { ckey: `conv:${s.activeConv}`, key: `fold:conv:${s.activeConv}` } : undefined} />
      {browsing && <Btn label="返回工作区" ic="chevron" variant="ghost" size="sm" title={`正在浏览工作区之外的文件夹：${root}`} onClick={backToWorkspace} />}
      <span className="grow" />
      <IconBtn ic="refresh" label="刷新文件列表" size="sm" onClick={() => { void refreshWorkspace().then(() => toast('文件列表已刷新', 'refresh')); }} />
      <OpenFolderButton dir={root} />
    </div>
    <div className="workspace-files__split">
      <FileReading />
      <section className="file-browser" aria-label="文件目录">
        <label className="search file-browser__filter"><Icon name="search" /><input className="input" type="search" aria-label="筛选文件" placeholder="筛选文件…" value={query} onChange={e => setFilter({ root, text: e.target.value })} /></label>
        <div className="file-browser__tree">
          {s.filesError
            ? <Empty ic="info" title={s.filesError.startsWith(MISSING_FOLDER) ? '还没有文件' : '读取文件夹失败'} desc={s.filesError} actions={<Btn label="重试" ic="refresh" variant="secondary" size="sm" onClick={() => void refreshWorkspace()} />} />
            : tree?.children?.length
              ? matches(tree, normalized) ? <div className="ftree"><Tree node={tree} query={normalized} /></div> : <p className="file-browser__note" role="status">没有匹配的文件</p>
              : <p className="file-browser__note" role="status">{!root ? '还没有选择工作文件夹' : s.filesLoading || !tree ? <><Spinner />正在读取…</> : '文件夹是空的'}</p>}
          {tree && <TreeNotes tree={tree} showAll={s.filesShowAll} />}
        </div>
      </section>
    </div>
  </div>;
}
