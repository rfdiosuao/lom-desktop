import { useEffect, useState } from 'react';
import { closeModal, toast, toastError } from '@/shared/overlays/controller';
import { Btn, IconBtn } from '@/shared/ui/Button';
import { Badge, Tabs, Toggle } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { Field } from '@/shared/ui/Layout';
import { Modal } from '@/shared/ui/Overlay';
import { checkShot, followUp, loadFeedback, readFeedback, submitFeedback, unreadFeedback, type FeedbackThread } from '../runtime/feedback';
import { useStore } from '@/state/store';
import { friendlyError } from '@/shared/lib/friendlyError';

/* ===== 帮助与反馈（A04 §2.2）：写反馈（最多 3 张截图）、查看站长回复并追问 ===== */

const STATUS: Record<FeedbackThread['status'], [string, 'ok' | 'warn' | undefined]> = { open: ['等待回复', 'warn'], replied: ['已回复', 'ok'], closed: ['已关闭', undefined] };
const when = (s: number) => new Date(s * 1000).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function Write({ onSent }: { onSent: () => void }) {
  const [text, setText] = useState('');
  const [shots, setShots] = useState<File[]>([]);
  const [diag, setDiag] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const add = (files: File[]) => {
    const bad = files.map(checkShot).find(Boolean);
    if (bad) { setError(bad); return; }
    setError('');
    setShots(prev => [...prev, ...files].slice(0, 3));
  };
  const send = async () => {
    setBusy(true); setError('');
    try { await submitFeedback(text, shots, diag); toast('已提交，站长回复后设置图标上会出现小红点', 'check'); onSent(); }
    catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  };
  return <>
    <Field label="描述问题或建议" hint={`${text.trim().length} / 2000 字，至少 5 字`}>
      <textarea className="textarea" rows={5} maxLength={2000} value={text} placeholder="遇到了什么问题？在哪一步？可以直接粘贴截图。" autoFocus
        onChange={e => setText(e.target.value)}
        onPaste={e => { const files = [...e.clipboardData.files].filter(f => f.type.startsWith('image/')); if (files.length) { e.preventDefault(); add(files); } }} />
    </Field>
    <div className="fb-shots">
      {shots.map((f, i) => (
        <span key={`${f.name}${i}`} className="fb-shot"><img src={URL.createObjectURL(f)} alt="" /><IconBtn ic="close" label="移除截图" size="sm" onClick={() => setShots(shots.filter((_, j) => j !== i))} /></span>
      ))}
      {shots.length < 3 && (
        <label className="fb-shot fb-shot--add"><Icon name="image" /><span>添加截图</span>
          <input type="file" accept="image/png,image/jpeg" multiple onChange={e => { add([...(e.target.files || [])]); e.target.value = ''; }} />
        </label>
      )}
    </div>
    <Field label="附带 App 版本和系统版本" inline><Toggle on={diag} onChange={() => setDiag(!diag)} label="附带诊断信息" /></Field>
    <p className="muted" style={{ fontSize: 13 }}>不会附带你的对话内容和文件。</p>
    {error && <p className="form-error" role="alert"><Icon name="info" />{error}</p>}
    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
      <Btn label={busy ? '正在提交…' : '提交反馈'} variant="primary" onClick={() => void send()} disabled={busy || text.trim().length < 5} />
    </div>
  </>;
}

function Thread({ t }: { t: FeedbackThread }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = () => { setOpen(!open); if (!open) void readFeedback(t.id).catch(e => toastError('标记已读失败', e)); };
  const send = async () => {
    setBusy(true);
    try { await followUp(t.id, text); setText(''); toast('已发送', 'check'); }
    catch (e) { toastError('发送失败', e); }
    finally { setBusy(false); }
  };
  const [label, tone] = STATUS[t.status];
  return (
    <div className="fb-thread">
      <button type="button" className="fb-thread__head" onClick={toggle} aria-expanded={open}>
        {t.unread && <span className="dot-red" aria-label="有新回复" />}
        <span className="fb-thread__title">{t.messages[0]?.text.slice(0, 40) || '反馈'}</span>
        <Badge text={label} tone={tone} /><span className="muted">{when(t.updated_at)}</span>
        <Icon name="chevron" />
      </button>
      {open && <div className="fb-thread__body">
        {t.messages.map((m, i) => (
          <div key={i} className={`fb-msg ${m.author === 'admin' ? 'fb-msg--admin' : ''}`}>
            <div className="fb-msg__who">{m.author === 'admin' ? '麓鸣团队' : '我'} · {when(m.at)}</div>
            {/* 回复按纯文本显示 */}
            <div className="fb-msg__text">{m.text}</div>
          </div>
        ))}
        {t.status !== 'closed' ? (
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <input className="input grow" value={text} maxLength={2000} placeholder="继续补充或追问…" onChange={e => setText(e.target.value)} />
            <Btn label={busy ? '发送中…' : '发送'} variant="secondary" size="sm" onClick={() => void send()} disabled={busy || !text.trim()} />
          </div>
        ) : <p className="muted" style={{ fontSize: 13 }}>这条反馈已关闭，有新问题请新写一条。</p>}
      </div>}
    </div>
  );
}

export function FeedbackModal() {
  const s = useStore();
  const [tab, setTab] = useState<'write' | 'mine'>(s.feedback.some(f => f.unread) ? 'mine' : 'write');
  useEffect(() => { void loadFeedback(); }, []);
  const unread = unreadFeedback();
  return (
    <Modal title="帮助与反馈" desc="问题和建议会直接发给麓鸣团队；回复会出现在「我的反馈」里。" foot={<Btn label="关闭" variant="secondary" onClick={closeModal} />}>
      <Tabs items={[{ value: 'write', label: '写反馈' }, { value: 'mine', label: unread ? `我的反馈 · ${unread} 条新回复` : '我的反馈', count: s.feedback.length }]} value={tab} onChange={v => setTab(v as 'write' | 'mine')} />
      <div style={{ height: 14 }} />
      {tab === 'write'
        ? <Write onSent={() => setTab('mine')} />
        : s.feedback.length ? <div className="fb-list">{s.feedback.map(t => <Thread key={t.id} t={t} />)}</div> : <p className="muted">还没有提交过反馈。</p>}
    </Modal>
  );
}
