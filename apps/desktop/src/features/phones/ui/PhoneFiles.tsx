import { useEffect, useState } from 'react';
import { listPhoneFiles, uploadPhoneFile, downloadPhoneFile, deletePhoneFile, savePhoneGallery } from '../runtime/phoneFiles';
import { pickFiles } from '@/core/platform';
import { agent } from '@/state/selectors';
import { basename } from '@/shared/lib/util';
import type { DraftAttachment } from '@/state/types';
import type { FileState } from '@/core/remoteWire';
import { Modal } from '@/shared/ui/Overlay';
import { Btn } from '@/shared/ui/Button';
import { closeModal, toast } from '@/shared/overlays/controller';

export function PhoneFilesModal({ device }: { device: string }) {
  const [files, setFiles] = useState<FileState[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<DraftAttachment[]>([]);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let active = true;
    listPhoneFiles(device).then(items => { if (active) setFiles(items); }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [device]);
  async function upload(retry: boolean) {
    setError(''); setBusy('传输中');
    try {
      const items: DraftAttachment[] = retry ? pending : (await pickFiles()).map(path => ({ name: basename(path), path }));
      setPending(items);
      for (const a of items) {
        setBusy(`正在发送 ${a.name}`);
        const timer = window.setInterval(() => setProgress(a.progress || 0), 200);
        try { await uploadPhoneFile(device, a); } finally { clearInterval(timer); }
      }
      setPending([]); setFiles(await listPhoneFiles(device));
      if (items.length) toast('手机已接收并校验文件', 'check');
    } catch (e) { setError(String(e)); } finally { setBusy(''); setProgress(0); }
  }
  async function act(file: FileState, remove: boolean | 'gallery') {
    setBusy(remove === 'gallery' ? '正在保存到手机相册' : remove ? '正在删除' : `正在下载 ${file.name}`); setError('');
    try {
      if (remove === 'gallery') { await savePhoneGallery(device, file.id); toast('已保存到手机相册 · Lom', 'check'); }
      else if (remove) { await deletePhoneFile(device, file.id); setFiles(await listPhoneFiles(device)); }
      else if (await downloadPhoneFile(device, file)) toast('文件已保存到电脑', 'check');
    } catch (e) { setError(String(e)); } finally { setBusy(''); }
  }
  return <Modal title={`${agent(device)?.name || '手机'} · 传输文件`} desc="加密传输，单文件最大 100 MB。这里管理传输暂存文件；聊天附件可直接拖入输入框。"
    foot={<><Btn label="选择文件发送" onClick={() => void upload(false)} disabled={!!busy} variant="primary" /><Btn label="关闭" onClick={closeModal} disabled={!!busy} /></>}>
    {busy && <p role="status">{busy}{progress ? ` · ${progress}%` : ''}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {!!pending.length && !busy && <Btn label="重试未确认的传输" onClick={() => void upload(true)} />}
    {!files.length && !busy && <p className="muted">暂无已完成的传输</p>}
    {files.map(file => <div key={file.id} className="row" style={{ marginBottom: 12 }}>
      <span className="grow">{file.name} {file.status !== 'complete' ? '（未完成）' : ''} · {(Number(file.size) / 1024).toFixed(1)} KB</span>
      {/^(image|video)\//.test(file.mime) && <Btn label="保存到手机相册" onClick={() => void act(file, 'gallery')} disabled={!!busy || file.status !== 'complete'} />}
      <Btn label="下载" onClick={() => void act(file, false)} disabled={!!busy || file.status !== 'complete'} />
      <Btn label="删除暂存" onClick={() => void act(file, true)} disabled={!!busy} />
    </div>)}
  </Modal>;
}
