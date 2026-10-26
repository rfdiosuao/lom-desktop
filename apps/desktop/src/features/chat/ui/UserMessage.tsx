import { normalizeConvId } from '@/state/selectors';
import { downloadChatAttachment } from '@/features/phones/runtime/phoneFiles';
import { turtleDisplayText } from '../runtime/turtlePrompt';
import { channelName } from '../runtime/channelSource';
import { useState } from 'react';
import { Btn, IconBtn } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { toast, toastError } from '@/shared/overlays/controller';
import { checkUnconfirmedMessage, resendEditedMessage, retryFailedMessage } from '../actions/message';
import { useStore } from '@/state/store';
import type { Msg } from '@/state/types';
import { fmtTime } from '@/shared/lib/util';
import { friendlyError } from '@/shared/lib/friendlyError';

export function UserMessage({ m, ctxId }: { m: Msg; ctxId: string }) {
  const s = useStore();
  const runId = normalizeConvId(ctxId);
  const displayText = turtleDisplayText(m.text || '');
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(displayText);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('剪贴板不可用');
      await navigator.clipboard.writeText(displayText); toast('已复制到剪贴板');
    } catch (e) { toastError('复制失败', e); }
  };
  const submit = async () => {
    if (!text.trim() || busy || s.running[runId]) return;
    setBusy(true); setError('');
    try {
      if (await resendEditedMessage(ctxId, m, text.trim())) setEditing(false);
      else setError('发送失败，修改内容已保留，请重试。');
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  };
  return <div className="msg msg--user"><div className={`msg__user-content${editing ? ' is-editing' : ''}`}>
    {editing ? <div className="msg__editor">
      <textarea aria-label="编辑消息内容" value={text} onChange={e => setText(e.target.value)} autoFocus rows={4} disabled={busy} />
      <p className="muted">修改后作为新消息发送，原消息和执行记录保留。{m.attachments?.length ? '原附件仍保留在原消息中。' : ''}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="row"><span className="grow" /><Btn label="取消" size="sm" disabled={busy} onClick={() => setEditing(false)} /><Btn label={busy ? '发送中…' : '发送修改'} size="sm" variant="primary" disabled={busy || !!s.running[runId] || !text.trim()} onClick={() => void submit()} /></div>
    </div> : <>
      <div className="msg__bubble">{m.source === 'schedule' && <div className="msg__schedule-source"><Icon name="clock" />由定时任务发送</div>}
        {(m.source === 'feishu' || m.source === 'wechat') && <div className="msg__schedule-source"><span className={`msg__channel-icon msg__channel-icon--${m.source}`} aria-hidden="true" />来自{channelName(m.source)}</div>}
        {m.source === 'personal' && <div className="msg__schedule-source"><Icon name="sparkles" />由个人助理派发</div>}{displayText}
        {!!m.attachments?.length && <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>{m.attachments.map((a, i) => <span key={i} className="attach">{a.preview ? <img className="attach__thumb" src={a.preview} alt="" /> : <Icon name={a.ic || 'file'} />}{a.name}{a.phoneFile && <Btn label={downloading ? '下载中…' : '下载'} size="sm" disabled={downloading} onClick={async () => {
          setDownloading(true); try { if (await downloadChatAttachment(a.phoneFile!)) toast('附件已保存到电脑'); }
          catch (e) { toastError('下载附件失败', e); } finally { setDownloading(false); }
        }} />}</span>)}</div>}
      </div>
      <div className="msg__user-actions"><time>{fmtTime(m.at)}</time>
        {m.status === 'unconfirmed' && <><span>发送结果未确认</span><Btn label={busy ? '核对中…' : '核对记录'} size="sm" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await checkUnconfirmedMessage(ctxId); }
          catch (e) { toastError('核对发送记录失败', e); }
          finally { setBusy(false); }
        }} /></>}
        {m.status === 'error' && <Btn label={busy ? '重试中…' : '重新发送'} size="sm" disabled={busy || !!s.running[runId]} onClick={async () => {
          setBusy(true);
          try { if (!await retryFailedMessage(ctxId, m)) toast('发送失败，原消息和附件仍可重试', 'info'); }
          catch (e) { toastError('重新发送失败', e); }
          finally { setBusy(false); }
        }} />}
        <IconBtn ic="copy" label="复制消息" size="sm" onClick={() => void copy()} />
        {!m.source && <IconBtn ic="edit" label="编辑消息" size="sm" disabled={!!s.running[runId]} onClick={() => { setText(displayText); setError(''); setEditing(true); }} />}
      </div>
    </>}
  </div></div>;
}
