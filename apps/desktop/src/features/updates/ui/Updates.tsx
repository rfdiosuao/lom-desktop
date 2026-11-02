import { useEffect } from 'react';
import { openModal, closeModal, guardClose } from '@/shared/overlays/controller';
import { Btn } from '@/shared/ui/Button';
import { Modal } from '@/shared/ui/Overlay';
import { desktopUpdater, updateBusy, useUpdater } from '../runtime/updater';
import { t } from '@/shared/i18n/index';
import { useStore } from '@/state/store';

export function UpdateBanner() {
  const u = useUpdater();
  const s = useStore();
  if (!['available', 'downloading', 'ready', 'installing'].includes(u.phase) || s.modals.some(m => m.id === 'update')) return null;
  return <aside className="update-banner" role="status">
    <span>{t(u.phase === 'ready' ? '新版已下载，等待安装' : '发现新版本')} · {u.version}</span>
    <Btn label="查看更新" size="sm" onClick={() => openModal('update')} />
  </aside>;
}
export function UpdateModal() {
  const u = useUpdater();
  useStore();
  const busy = updateBusy();
  useEffect(() => { guardClose('update', () => desktopUpdater.snapshot().phase !== 'installing'); return () => guardClose('update', null); }, []);
  const percent = u.total ? Math.min(100, Math.round(u.received / u.total * 100)) : undefined;
  return <Modal title="源码更新" desc={`Lom ${__LOM_VERSION__}${u.version ? ` → ${u.version}` : ''}`}
    foot={<>
      <Btn label="稍后" onClick={closeModal} disabled={u.phase === 'installing'} />
      {['idle', 'current', 'error'].includes(u.phase) && <Btn label="检查更新" onClick={() => void desktopUpdater.check()} />}
      {['available', 'error'].includes(u.phase) && u.version && <Btn label="下载更新" variant="primary" onClick={() => void desktopUpdater.download()} />}
      {u.phase === 'ready' && <Btn label="安装并重启" variant="primary" disabled={busy} onClick={() => void desktopUpdater.install()} />}
    </>}>
    <p role="status">开源版已停用自动更新。请从公开仓库获取源码并自行构建。</p>
    {u.phase === 'downloading' && <div><progress aria-label={t('下载进度')} value={percent} max={100} /> <span>{percent === undefined ? `${(u.received / 1048576).toFixed(1)} MB` : `${percent}%`}</span></div>}
    {u.notes && <div className="update-notes">{u.notes}</div>}
    {u.error && <p role="alert" className="update-error">{t(u.error)}</p>}
    <p className="muted">{t(busy ? '还有任务正在运行，请等任务结束后再安装。' : '安装会退出并重新打开 Lom，请先保存正在编辑的内容。')}</p>
  </Modal>;
}
