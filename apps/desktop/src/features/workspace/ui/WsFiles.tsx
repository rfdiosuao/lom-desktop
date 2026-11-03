import { useState } from 'react';
import { Btn, Dropdown, IconBtn } from '@/shared/ui/Button';
import { Spinner } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { Empty } from '@/shared/ui/Layout';
import { toast, toastError } from '@/shared/overlays/controller';
import { basename, cx, prettyPath } from '@/shared/lib/util';
import { conv } from '@/state/selectors';
import { update, useStore } from '@/state/store';
import type { FileNode } from '@/state/types';
import { activeFolder, MISSING_FOLDER, openFile, openInSystem, refreshWorkspace, revealInSystem } from '../runtime/workspace';
import './workspaceFiles.css';

function matches(node: FileNode, query: string): boolean {
  return node.name.toLocaleLowerCase().includes(query) || !!node.children?.some(child => matches(child, query));
}
function Tree({ node, query, depth = 0 }: { node: FileNode; query: string; depth?: number }) {
  const s = useStore();
  if (query && !matches(node, query)) return null;
  const folder = node.type === 'dir', open = !!query || !!s.treeOpen[node.path];
  const selected = s.openFile === node.path;
  const icon = folder ? 'folder' : /\.(png|jpe?g|gif|webp|svg)$/i.test(node.name) ? 'image' : /\.(md|txt)$/i.test(node.name) ? 'file' : 'fileCode';
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
function FileReading() {
  const s = useStore();
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('当前环境不支持复制');
      await navigator.clipboard.writeText(s.openFileContent);
      toast('已复制文件内容');
    } catch (e) { toastError('复制失败', e); }
  };
  return <section className="file-reading" aria-label="文件阅读区">
    <div className="file-reading__head">
      <Icon name="file" /><span className="grow ellipsis" title={s.openFile || ''}>{s.openFile ? basename(s.openFile) : '文件预览'}</span>
      {s.openFile && <>
        <IconBtn ic="copy" label="复制内容" size="sm" disabled={!s.openFileContent} onClick={() => void copy()} />
        <IconBtn ic="external" label="用默认应用打开" size="sm" onClick={() => { void openInSystem(s.openFile || '').catch(e => toastError('打开失败', e)); }} />
        <IconBtn ic="close" label="关闭文件预览" size="sm" onClick={() => void openFile(null)} />
      </>}
    </div>
    {s.openFile
      ? <div className="code" tabIndex={0} aria-label="文件内容">{s.openFileContent ? s.openFileContent.split('\n').map((line, i) => <div key={i} className="code__line">{line || ' '}</div>) : <div className="file-reading__loading"><Spinner />读取中…</div>}</div>
      : <Empty ic="file" title="选择一个文件" desc="目录会保留在旁边，方便连续查看。" />}
  </section>;
}
export function WsFiles() {
  const s = useStore(), root = activeFolder();
  const [filter, setFilter] = useState({ root, text: '' });
  const query = filter.root === root ? filter.text : '';
  const normalized = query.trim().toLocaleLowerCase();
  const inTask = s.route.name === 'chat' && !!conv(s.activeConv)?.remote;
  return <div className="workspace-files">
    <div className="workspace-files__toolbar">
      <Dropdown label={root ? prettyPath(root, s.homeDir) : '选择文件夹'} ic="folder" menu="folder" variant="secondary" size="sm" title={inTask ? `这个任务的工作文件夹：${root}` : root}
        className="btn--path" ctx={inTask ? { ckey: `conv:${s.activeConv}`, key: `fold:conv:${s.activeConv}` } : undefined} />
      <span className="grow" />
      <IconBtn ic="refresh" label="刷新文件列表" size="sm" onClick={() => { void refreshWorkspace().then(() => toast('文件列表已刷新', 'refresh')); }} />
      <IconBtn ic="external" label="在访达中显示" size="sm" disabled={!root} onClick={() => { void revealInSystem(root).catch(e => toastError('打开失败', e)); }} />
    </div>
    <div className="workspace-files__split">
      <FileReading />
      <section className="file-browser" aria-label="文件目录">
        <label className="search file-browser__filter"><Icon name="search" /><input className="input" type="search" aria-label="筛选文件" placeholder="筛选文件…" value={query} onChange={e => setFilter({ root, text: e.target.value })} /></label>
        <div className="file-browser__tree">
          {s.filesError
            ? <Empty ic="info" title={s.filesError.startsWith(MISSING_FOLDER) ? '还没有文件' : '读取文件夹失败'} desc={s.filesError} actions={<Btn label="重试" ic="refresh" variant="secondary" size="sm" onClick={() => void refreshWorkspace()} />} />
            : s.files?.children?.length
              ? matches(s.files, normalized) ? <div className="ftree"><Tree node={s.files} query={normalized} /></div> : <p className="file-browser__note" role="status">没有匹配的文件</p>
              : <p className="file-browser__note" role="status">{s.filesLoading ? <><Spinner />正在读取…</> : s.files ? '文件夹是空的' : '还没有选择工作文件夹'}</p>}
        </div>
      </section>
    </div>
  </div>;
}
