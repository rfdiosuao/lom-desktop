import { t } from '@/shared/i18n/index';
import { PhoneScreen } from '@/features/phones/ui/PhoneScreen';
import { PhonePlaceholder } from '@/shared/ui/PhonePlaceholder';
import { dragWindow } from '@/core/platform';
import { toggleRight, wsTab } from '@/app/shell/layout';
import { openModal, toast, toastError } from '@/shared/overlays/controller';
import { sendFiles } from '@/features/phones/actions/phone';
import { DeviceButton } from '@/shared/ui/Agent';
import { Btn, Dropdown, IconBtn } from '@/shared/ui/Button';
import { Dot, Seg, Spinner, Tabs } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { Empty } from '@/shared/ui/Layout';
import { MISSING_FOLDER, activeFolder, openFile, openInSystem, refreshPreview, refreshWorkspace, revealInSystem } from '../runtime/workspace';
import { conv, phone } from '@/state/selectors';
import { update, useStore } from '@/state/store';
import type { FileNode } from '@/state/types';
import { WsChanges, WsPlan } from './WsActivity';
import { ago, basename, prettyPath } from '@/shared/lib/util';

/* ===== 右侧工作区：预览 / 文件 / 手机 ===== */

/** 作品预览：生成的页面在 sandbox iframe 里运行（只允许脚本，不与 Lom 同源） */
export function PreviewFrame({ device }: { device: 'desktop' | 'mobile' }) {
  const s = useStore();
  return (
    <div className={`preview-frame ${device === 'mobile' ? 'preview-frame--mobile' : ''}`}>
      {device === 'desktop' && <div className="preview-frame__chrome"><span /><span /><span /></div>}
      <iframe className="preview-frame__page" title="作品预览" sandbox="allow-scripts" srcDoc={s.previewHtml} key={s.previewAt} />
    </div>
  );
}

function WsPreview() {
  const s = useStore();
  const c = s.route.name === 'chat' ? conv(s.activeConv) : undefined;
  const st = c?.preview;
  if (!st || (!s.previewHtml && st !== 'building')) {
    return <>
      <div className="preview-empty"><Empty ic="globe" title="作品会在这里实时呈现" desc="让总指挥做一个网页、海报或文档，结果会自动出现在这里。" /></div>
      <div className="preview-status">{s.previewError ? <><Icon name="info" />预览失败：{s.previewError}</> : <><Dot />等待开始</>}</div>
    </>;
  }
  const file = c?.previewFile || '';
  return <>
    <div className="preview-bar">
      <Seg options={[{ value: 'desktop', ic: 'monitor', title: '桌面尺寸' }, { value: 'mobile', ic: 'phone', title: '手机尺寸' }]} value={s.previewDevice} onChange={v => update(x => { x.previewDevice = v; })} />
      <div className="addr" title={file}><Icon name="lock" />{basename(file) || '正在生成…'}</div>
      <IconBtn ic="refresh" label="刷新预览" size="sm" onClick={() => { void refreshPreview().then(() => toast('预览已刷新', 'refresh')); }} />
      <IconBtn ic="external" label="在浏览器打开" size="sm" disabled={!file} onClick={() => { openInSystem(file).catch(e => toastError('打开失败', e)); }} />
    </div>
    {st === 'building' && !s.previewHtml
      ? <div className="preview-frame"><div className="preview-frame__chrome"><span /><span /><span /></div><div className="preview-building"><Spinner />正在生成页面…</div></div>
      : <PreviewFrame device={s.previewDevice} />}
    <div className="preview-status">
      {st === 'building' ? <><Spinner />正在生成…</> : <><Dot />已更新 · {ago(s.previewAt)}</>}
      <span className="grow" />
      <Btn label="发给手机" ic="phone" size="sm" variant="secondary" onClick={() => sendFiles(s.phoneId)} />
    </div>
  </>;
}

function Tree({ node, depth = 0 }: { node: FileNode; depth?: number }) {
  const s = useStore();
  if (node.type === 'dir') {
    const open = !!s.treeOpen[node.path];
    return <>
      <button type="button" className="ftree__row" style={{ paddingLeft: 6 + depth * 14 }} onClick={() => update(x => { x.treeOpen[node.path] = !open; })}>
        <Icon name="chevron" className={`caret ${open ? '' : 'is-closed'}`} /><Icon name="folder" /><span className="grow ellipsis">{node.name}</span>
      </button>
      {open && node.children?.map(n => <Tree key={n.path} node={n} depth={depth + 1} />)}
    </>;
  }
  const ic = /\.(png|jpe?g|gif|webp|svg)$/i.test(node.name) ? 'image' : /\.(md|txt)$/i.test(node.name) ? 'file' : 'fileCode';
  return (
    <button type="button" className="ftree__row" style={{ paddingLeft: 24 + depth * 14 }} onClick={() => void openFile(node.path)}>
      <Icon name={ic} /><span className="grow ellipsis">{node.name}</span>
    </button>
  );
}

export function WsFiles() {
  const s = useStore();
  const root = activeFolder();
  if (s.openFile) {
    const content = s.openFileContent;
    return <>
      <div className="row" style={{ marginBottom: 10 }}>
        <IconBtn ic="back" label="返回文件列表" size="sm" onClick={() => void openFile(null)} />
        <b className="grow ellipsis" style={{ fontSize: 14 }}>{basename(s.openFile)}</b>
        <IconBtn ic="copy" label="复制内容" size="sm" onClick={() => { void navigator.clipboard?.writeText(content).then(() => toast('已复制文件内容')); }} />
        <IconBtn ic="external" label="用默认应用打开" size="sm" onClick={() => { openInSystem(s.openFile || '').catch(e => toastError('打开失败', e)); }} />
      </div>
      <div className="code">{content ? content.split('\n').map((l, i) => <div key={i} className="code__line">{l || ' '}</div>) : <div className="code__line">读取中…</div>}</div>
    </>;
  }
  const inTask = s.route.name === 'chat' && !!conv(s.activeConv)?.remote;
  return <>
    <div className="row" style={{ marginBottom: 10 }}>
      {inTask
        ? <Dropdown label={prettyPath(root, s.homeDir)} ic="folder" menu="folder" variant="secondary" size="sm" title={`这个任务的工作文件夹：${root}`} className="btn--path" ctx={{ ckey: `conv:${s.activeConv}`, key: `fold:conv:${s.activeConv}` }} />
        : <Dropdown label={root ? prettyPath(root, s.homeDir) : '选择文件夹'} ic="folder" menu="folder" variant="secondary" size="sm" title={root} className="btn--path" />}
      <span className="grow" />
      <IconBtn ic="refresh" label="刷新" size="sm" onClick={() => { void refreshWorkspace().then(() => toast('文件列表已刷新', 'refresh')); }} />
      <IconBtn ic="external" label="在访达中显示" size="sm" disabled={!root} onClick={() => { revealInSystem(root).catch(e => toastError('打开失败', e)); }} />
    </div>
    {s.filesError
      ? <Empty ic={s.filesError.startsWith(MISSING_FOLDER) ? 'folder' : 'info'} title={s.filesError.startsWith(MISSING_FOLDER) ? '还没有文件' : '读取文件夹失败'} desc={s.filesError} actions={<Btn label="重试" ic="refresh" variant="secondary" size="sm" onClick={() => void refreshWorkspace()} />} />
      : s.files
        ? (s.files.children?.length ? <div className="ftree"><Tree node={s.files} /></div> : <Empty ic="folder" title="文件夹是空的" desc="总指挥生成的文件会出现在这里。" />)
        : <div className="msg__sys">{s.filesLoading ? <><Spinner />正在读取…</> : '还没有选择工作文件夹'}</div>}
  </>;
}

function WsPhone() {
  useStore();
  const p = phone();
  return <>
    <DeviceButton phone={p} variant="panel" />
    {p.real ? <PhoneScreen key={p.id} device={p.id} /> : <PhonePlaceholder />}
  </>;
}

export function Workspace() {
  const s = useStore();
  return (
    <aside className="workspace" aria-label="工作区">
      <div className="workspace__head" onMouseDown={dragWindow}>
        <h2 className="workspace__title">{t('工作区')}</h2>
        <div className="row" style={{ gap: 2 }}>
          <IconBtn ic="expand" label="全屏查看" onClick={() => openModal('full')} />
          <IconBtn ic="chevronRight" label="收起工作区" onClick={toggleRight} />
        </div>
      </div>
      <div className="workspace__tabs"><Tabs items={[{ value: 'preview', label: '预览' }, { value: 'files', label: '文件' }, { value: 'plan', label: '计划' }, { value: 'changes', label: '变更' }, { value: 'phone', label: '手机' }]} value={s.wsTab} onChange={wsTab} /></div>
      <div className="workspace__body">{s.wsTab === 'preview' ? <WsPreview /> : s.wsTab === 'files' ? <WsFiles /> : s.wsTab === 'plan' ? <WsPlan /> : s.wsTab === 'changes' ? <WsChanges /> : <WsPhone />}</div>
    </aside>
  );
}
