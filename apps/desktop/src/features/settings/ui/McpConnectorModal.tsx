import { t } from '@/shared/i18n/index';
import { useEffect, useRef, useState } from 'react';
import { closeModal, guardClose, toast, topModal } from '@/shared/overlays/controller';
import { Btn } from '@/shared/ui/Button';
import { Modal } from '@/shared/ui/Overlay';
import { useStore } from '@/state/store';
import { parseTransport, saveMcp } from '../runtime/mcpManager';
import { McpTransportEditor } from './McpTransportEditor';
import './connectorModal.css';

export function McpConnectorModal({ p }: { p: Record<string, unknown> }) {
  const [name, setName] = useState(typeof p.name === 'string' ? p.name : '');
  const [transport, setTransport] = useState(() => JSON.stringify({
    type: 'http', url: typeof p.url === 'string' ? p.url : '',
  }));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const top = useStore().modals.at(-1);
  const saving = useRef(false);
  useEffect(() => {
    guardClose('mcpConnector', () => !saving.current);
    return () => guardClose('mcpConnector', null);
  }, []);
  useEffect(() => {
    if (saved && topModal()?.props === p) closeModal(true);
  }, [saved, top, p]);
  const submit = async () => {
    if (saving.current || saved) return;
    saving.current = true;
    setError('');
    setBusy(true);
    try {
      await saveMcp(name, transport);
      setSaved(true);
      toast(t('连接器已保存，可在管理中测试连接'), 'check');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('保存失败，请检查连接配置'));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  let ready = !!name.trim();
  try { parseTransport(transport); } catch { ready = false; }
  return <Modal title="新建自定义连接器" desc="添加远程 MCP 服务或本机程序，供电脑任务使用。" className="connector-modal"
    foot={<><Btn label="取消" disabled={busy} onClick={closeModal}/><Btn label={busy ? '保存中…' : '保存'}
      variant="primary" disabled={busy || saved || !ready} onClick={() => void submit()}/></>}>
    <div className="connector-form">
      <label>{t('服务器名称')}<input className="input" placeholder={t('例如：文档工具')} autoFocus value={name}
        disabled={busy} onChange={e => setName(e.target.value)}/></label>
      <McpTransportEditor value={transport} onChange={setTransport} disabled={busy}/>
    </div>
    {error && <p role="alert">{error}</p>}
  </Modal>;
}
