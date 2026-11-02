import { PersonalPermissions } from './PersonalPermissions';
import { AvatarPicker } from './AvatarPicker';
import { avatarUrl, DEFAULT_AVATAR, type AvatarId } from '../runtime/avatars';
import { authAccount } from '@/features/account/runtime/authScope';
import { personalError } from '../runtime/errors';
import { refreshTaskList } from '@/features/chat/runtime/taskSync';
import { useEffect, useRef, useState } from 'react';
import { pickFolder } from '@/core/platform';
import { useStore } from '@/state/store';
import { Btn, IconBtn } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { Spinner } from '@/shared/ui/Controls';
import { confirm, prompt, toast, toastError } from '@/shared/overlays/controller';
import { Composer } from '@/features/chat/ui/Composer';
import { MessageList } from '@/features/chat/ui/MessageList';
import { ReplyPending } from '@/features/chat/ui/ReplyPending';
import { useStickBottom } from '@/features/chat/ui/Chat';
import { addAssistant, loadAssistants, storeAssistant, type PersonalAssistant } from '../runtime/catalog';
import { ensureConversation, linkWorkspace } from '../runtime/session';
import { PersonalDocuments } from './PersonalDocuments';
import { deleteAssistant } from '../runtime/deleteAssistant';
import { PersonalSchedules } from './PersonalSchedules';
import { FeishuConnect } from './FeishuConnect';

export function PersonalAgent({ onClose, onMinimize }: { onClose: () => void; onMinimize: () => void }) {
  const s = useStore(), account = s.account?.id;
  const [items, setItems] = useState<PersonalAssistant[]>([]), [selected, setSelected] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const [closed, setClosed] = useState<string[]>([]);
  const [readyKey, setReadyKey] = useState('');
  const a = items.find(x => x.id === selected), c = a?.conversation && s.cloud === 'signed-in' && readyKey === `${account}:${a.id}:${a.conversation}` ? s.convs.find(x => x.id === a.conversation) : undefined;
  const stick = useStickBottom<HTMLDivElement>();
  useEffect(() => {
    generation.current++; setReadyKey(''); setSelected(''); setItems([]); setClosed([]); setError('');
    try { const data = loadAssistants(); setItems(data.items); setSelected(data.selected || data.items[0]?.id || ''); }
    catch (e) { setError(personalError(e)); }
  }, [account, s.cloud]);
  useEffect(() => {
    setReadyKey('');
    if (!a || s.conn !== 'ready' || s.cloud !== 'signed-in') return;
    const attempt = ++generation.current; setBusy(true); setError('');
    void ensureConversation(a).then(id => {
      if (generation.current !== attempt) return;
      setItems(loadAssistants().items); setReadyKey(`${account}:${a.id}:${id}`);
    }, e => { if (generation.current === attempt) setError(personalError(e)); }).finally(() => { if (generation.current === attempt) setBusy(false); });
      return () => { if (generation.current === attempt) generation.current++; };
  }, [selected, s.conn, s.cloud, account, retry]);
  useEffect(() => { if (stick.ref.current) stick.ref.current.scrollTop = stick.ref.current.scrollHeight; }, [c?.id]);
  const create = () => { const current = authAccount(); let avatar: AvatarId = DEFAULT_AVATAR; prompt({ extra: <AvatarPicker onChange={id => { avatar = id; }} />, title: '新建个人助理', label: '助理名称', placeholder: '例如：小麓、工作助理', okText: '创建助理', onOk: name => {
    if (!current()) { toastError('创建助理失败', new Error('账号已切换，请重新打开助理')); return; }
    const owner = account; setBusy(true);
    void addAssistant(name, avatar).then(created => { if (owner === s.account?.id) { setItems(loadAssistants().items); setSelected(created.id); } }, e => toastError('创建助理失败', new Error(personalError(e)))).finally(() => setBusy(false));
  } }); };
  const select = (item: PersonalAssistant) => { generation.current++; storeAssistant(loadAssistants().items.find(x => x.id === item.id) ?? item); setSelected(item.id); };
  const closeAssistant = (item: PersonalAssistant) => {
    const hidden = [...closed, item.id]; setClosed(hidden);
    if (item.id !== selected) return;
    generation.current++; setReadyKey(''); setBusy(false); setError('');
    const next = items.find(x => !hidden.includes(x.id));
    if (next) select(next); else setSelected('');
  };
  // PA-DELETE：真正删除这位助理（会话归档可找回，文档目录保留）
  const remove = (item: PersonalAssistant) => confirm({
    title: `删除助理「${item.name}」？`, okText: '删除', danger: true,
    desc: '会删除它的定时任务、解除飞书绑定，并把它的对话移到「归档的任务」（可以找回）。助理文档保留在本机。',
    onOk: () => {
      const owner = account; setBusy(true);
      void deleteAssistant(item).then(() => {
        if (owner !== s.account?.id) return;
        generation.current++; setReadyKey(''); setError('');
        const rest = loadAssistants().items; setItems(rest); setSelected(rest[0]?.id ?? '');
        toast(`已删除助理「${item.name}」`, 'trash');
      }, e => toastError('删除助理失败', new Error(personalError(e)))).finally(() => setBusy(false));
    },
  });
  const folder = async () => {
    if (!a) return; const current = authAccount();
    try { const path = await pickFolder(); if (!current()) throw new Error('账号已切换'); if (path) { await linkWorkspace(a, path); setItems(loadAssistants().items); } }
    catch (e) { toastError('关联文件夹失败', new Error(personalError(e))); }
  };
  return <div className="pa-window">
    <header className="pa-titlebar"><strong className="pa-brand">Lom</strong>
      <div className="pa-assistants" aria-label="个人助理列表">{items.filter(item => !closed.includes(item.id)).map(item => <div className="pa-assistant-tab" key={item.id}>
        <Btn label={<><img src={avatarUrl(item.avatar)} alt="" />{item.name}</>} variant="pill" active={item.id === selected} onClick={() => select(item)} />
        <IconBtn ic="close" size="sm" label={`关闭助理标签：${item.name}`} onClick={() => closeAssistant(item)} />
      </div>)}</div>
      {closed.length > 0 && <Btn label="恢复助理" variant="ghost" title="恢复已关闭的助理标签，会话与记忆均保留" onClick={() => { setClosed([]); if (!selected && items[0]) select(items[0]); }} />}
      <Btn label="新建助理" ic="plus" variant="pill" onClick={create} disabled={busy && !a} />
      <div className="pa-window-actions"><Btn label="通话" ic="phone" disabled title="桌面AI通话尚未接入" /><IconBtn ic="minus" label="最小化" onClick={onMinimize} /><IconBtn ic="close" label="关闭个人助理" onClick={onClose} /></div>
    </header>
    <main className="pa-body"><section className="pa-conversation" aria-label="个人助理对话">
      <div className="pa-chathead"><img className="pa-avatar" src={avatarUrl(a?.avatar)} alt="" /><div><strong>{a?.name || 'Personal Agent'} · Personal Agent</strong><small>独立会话与记忆</small></div><IconBtn ic="folder" label="关联工作文件夹" disabled={!c || busy} onClick={() => void folder()} /></div>
      {a && <div className="pa-workspace" title={a.workspace}>{a.workspace || '尚未关联工作文件夹'}</div>}
      <div className="pa-messages" ref={stick.ref} onScroll={stick.onScroll}>
        {error && <div className="pa-error" role="alert">{error}<Btn label="重新同步并重试" size="sm" onClick={() => { void refreshTaskList().then(() => setRetry(x => x + 1), e => toastError('重新同步失败', new Error(personalError(e)))); }} /></div>}
        {s.conn !== 'ready' && <p className="pa-muted">{s.conn === 'offline' ? '核心未连接，恢复连接后继续。' : '正在连接核心…'}</p>}
        {busy && <p className="pa-muted"><Spinner size={16} /> 正在读取助理会话…</p>}
        {!a ? <div className="pa-empty"><img src={avatarUrl()} alt="" /><h1>你的个人助理</h1><p>每位助理都有自己的对话、文档和记忆。</p><Btn label="新建助理" ic="plus" variant="primary" onClick={create} disabled={busy} /></div>
          : c ? <><MessageList msgs={c.messages} ctxId={c.id} />{s.running[c.id] && <ReplyPending c={c} />}{!c.messages.length && <div className="pa-empty"><h1>你好，我是{a.name}</h1><p>从一句话开始，我们在这里继续。</p></div>}</> : null}
      </div>
      <div className="pa-composer">{c && !busy && !error ? <Composer ckey={`personal:${a!.id}`} agentId="pc" compact note={false} toolbar={false} placeholder={`给${a?.name}发消息…`} /> : <div className="pa-composer-placeholder">{a ? '会话连接后可以发送消息' : '新建助理后开始对话'}</div>}</div>
    </section>
    <aside className="pa-inspector" aria-label="助理管理"><div className="pa-inspector__scroll">
      <section className="pa-section"><h2>通道连接</h2><FeishuConnect key={`feishu:${account}:${a?.id ?? 'none'}`} assistant={a} />{[{ name: '微信', icon: 'wechat' }].map(channel => <button type="button" disabled className="pa-channel" key={channel.name} aria-label={`${channel.name}（未接入）`}><span className={`pa-channel__icon pa-channel__icon--${channel.icon}`} aria-hidden="true" /><strong>{channel.name}</strong><span>未接入</span><Icon name="chevronRight" /></button>)}</section>
      {a ? <><PersonalPermissions key={`permissions:${account}:${a.id}`} assistant={a} />{c && <PersonalSchedules key={`tasks:${a.id}`} assistant={a} />}<PersonalDocuments key={`docs:${a.id}`} assistant={a} /><section className="pa-section"><Btn label="删除这位助理" ic="trash" variant="ghost" size="sm" className="pa-danger" disabled={busy || (!!a.conversation && !!s.running[a.conversation])} onClick={() => remove(a)} /></section></> : <p className="pa-muted">创建助理后，可以管理独立任务、文档、记忆与日记。</p>}
    </div><footer><Icon name="info" />会话、文档和记忆独立保存 · 通话尚未接入</footer></aside></main>
  </div>;
}
