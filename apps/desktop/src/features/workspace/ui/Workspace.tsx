import { NoPhone } from '@/features/phones/ui/NoPhone';
import { PhoneScreen } from '@/features/phones/ui/PhoneScreen';
import { PhonePlaceholder } from '@/shared/ui/PhonePlaceholder';
import { dragWindow } from '@/core/platform';
import { toggleRight, wsTab } from '@/app/shell/layout';
import { openModal, toast, toastError } from '@/shared/overlays/controller';
import { sendFiles } from '@/features/phones/actions/phone';
import { DeviceButton } from '@/shared/ui/Agent';
import { Btn, IconBtn } from '@/shared/ui/Button';
import { Dot, Seg, Spinner, Tabs } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { Empty } from '@/shared/ui/Layout';
import { openInSystem, refreshPreview } from '../runtime/workspace';
import { conv, phone } from '@/state/selectors';
import { S, update, useStore } from '@/state/store';
import { WsFiles } from './WsFiles';
export { WsFiles } from './WsFiles';
import { WsChanges, WsPlan } from './WsActivity';
import { ago, basename } from '@/shared/lib/util';

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

/** 当前会话有可预览的作品：正在生成或已经有页面（UI-AUDIT-02 UI-10） */
export function previewReady(s: Pick<typeof S, 'route' | 'activeConv' | 'previewHtml'> = S) {
  const st = s.route.name === 'chat' ? conv(s.activeConv)?.preview : undefined;
  return !!st && (!!s.previewHtml || st === 'building');
}

function WsPreview() {
  const s = useStore();
  const c = s.route.name === 'chat' ? conv(s.activeConv) : undefined;
  const st = c?.preview;
  if (!previewReady(s)) {
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

function WsPhone() {
  useStore();
  const p = phone();
  if (!p) return <NoPhone />;
  return <>
    <DeviceButton phone={p} variant="panel" />
    {p.real ? <PhoneScreen key={p.id} device={p.id} /> : <PhonePlaceholder />}
  </>;
}

export function Workspace() {
  const s = useStore();
  const canFull = s.wsTab !== 'preview' || previewReady(s);
  return (
    <aside className="workspace" aria-label="工作区">
      <div className="workspace__head" onMouseDown={dragWindow}>
        <div className="workspace__tabs"><Tabs items={[{ value: 'preview', label: '预览' }, { value: 'files', label: '文件' }, { value: 'plan', label: '计划' }, { value: 'changes', label: '变更' }, { value: 'phone', label: '手机' }]} value={s.wsTab} onChange={wsTab} /></div>
        <div className="row" style={{ gap: 2 }}>
          <IconBtn ic="expand" label={canFull ? '全屏查看' : '全屏查看（还没有作品）'} onClick={() => openModal('full')} disabled={!canFull} />
          <IconBtn ic="chevronRight" label="收起工作区" onClick={toggleRight} />
        </div>
      </div>
      <div className={`workspace__body${s.wsTab === 'files' ? ' workspace__body--files' : ''}`}>{s.wsTab === 'preview' ? <WsPreview /> : s.wsTab === 'files' ? <WsFiles /> : s.wsTab === 'plan' ? <WsPlan /> : s.wsTab === 'changes' ? <WsChanges /> : <WsPhone />}</div>
    </aside>
  );
}
