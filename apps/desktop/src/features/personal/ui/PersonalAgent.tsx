import { PersonalMcp } from './PersonalMcp';
import { PersonalPermissions } from './PersonalPermissions';
import { compactStoredAvatars } from '../runtime/avatarStore';
import { AvatarPicker } from './AvatarPicker';
import { AssistantAvatar } from './AssistantAvatar';
import { DEFAULT_AVATAR, type AvatarId } from '../runtime/avatars';
import { authAccount } from '@/features/account/runtime/authScope';
import { personalError } from '../runtime/errors';
import { refreshTaskList } from '@/features/chat/runtime/taskSync';
import { useEffect, useRef, useState } from 'react';
import { pickFolder } from '@/core/platform';
import { update, useStore } from '@/state/store';
import { Btn, IconBtn } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { Spinner } from '@/shared/ui/Controls';
import { confirm, openModal, prompt, toast, toastError } from '@/shared/overlays/controller';
import { Composer } from '@/features/chat/ui/Composer';
import { MessageList } from '@/features/chat/ui/MessageList';
import { ReplyPending } from '@/features/chat/ui/ReplyPending';
import { useStickBottom } from '@/features/chat/ui/Chat';
import { addAssistant, assistantNameError, loadAssistants, storeAssistant, type PersonalAssistant } from '../runtime/catalog';
import { ensureConversation, linkWorkspace } from '../runtime/session';
import { PersonalDocuments } from './PersonalDocuments';
import { deleteAssistant } from '../runtime/deleteAssistant';
import { PersonalSchedules } from './PersonalSchedules';
import { FeishuConnect } from './FeishuConnect';
import { AssistantTabs } from './AssistantTabs';

/** UI-AUDIT-03：头部只显示文件夹名；用助理自己的目录时说明是助理目录，完整路径放在提示里 */
const folderLabel = (a: PersonalAssistant) => !a.workspace ? '关联工作文件夹' : a.workspace === a.directory ? '助理目录' : a.workspace.split(/[\\/]/).filter(Boolean).pop() || a.workspace;

export function PersonalAgent({ onClose, onMinimize }: { onClose: () => void; onMinimize: () => void }) {
  const s = useStore(), account = s.account?.id;
  const [items, setItems] = useState<PersonalAssistant[]>([]), [selected, setSelected] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const generation = useRef(0), current = useRef('');
  const [readyKey, setReadyKey] = useState('');
  const a = items.find(x => x.id === selected), c = a?.conversation && s.cloud === 'signed-in' && readyKey === `${account}:${a.id}:${a.conversation}` ? s.convs.find(x => x.id === a.conversation) : undefined;
  const stick = useStickBottom<HTMLDivElement>();
  current.current = selected; // 删除结果回来时按当时选中的助理决定是否切换
  useEffect(() => {
    generation.current++; setReadyKey(''); setSelected(''); setItems([]); setError('');
    try { const data = loadAssistants(); setItems(data.items); setSelected(data.selected || data.items[0]?.id || ''); }
    catch (e) { setError(personalError(e)); }
  }, [account, s.cloud]);
  // 定时任务结果等外部入口要求打开某位助理（UI-AUDIT-02 UI-14）
  const focus = s.personalPanel?.focus;
  useEffect(() => {
    if (!focus) return;
    try { const data = loadAssistants(); setItems(data.items); if (focus.id !== selected && data.items.some(x => x.id === focus.id)) { generation.current++; setSelected(focus.id); } }
    catch (e) { setError(personalError(e)); }
  }, [focus?.at]);
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
  const create = () => { const current = authAccount(); let avatar: AvatarId = DEFAULT_AVATAR, avatarImage: string | undefined;
    prompt({ extra: <AvatarPicker onChange={(id, image) => { avatar = id; avatarImage = image; }} />, title: '新建个人助理', label: '助理名称', placeholder: '例如：小麓、工作助理', okText: '创建助理', validate: assistantNameError, onOk: name => {
    if (!current()) { toastError('创建助理失败', new Error('账号已切换，请重新打开助理')); return; }
    const owner = account; setBusy(true);
    // 先压缩旧版本留下的偏大头像腾出空间；压缩失败只记日志，不拦住创建
    const request = compactStoredAvatars(owner).catch(e => console.warn('personal.avatar_compact_failed', e instanceof Error ? e.message : e))
      .then(() => (avatarImage ? addAssistant(name, avatar, avatarImage) : addAssistant(name, avatar)));
    void request.then(created => { if (owner === s.account?.id) { setItems(loadAssistants().items); setSelected(created.id); } }, e => toastError('创建助理失败', new Error(personalError(e)))).finally(() => setBusy(false));
  } }); };
  const changeAvatar = (item: PersonalAssistant) => {
    if (!account) return;
    openModal('personalAvatar', { account, assistantId: item.id, onSaved: () => { if (s.account?.id === account) setItems(loadAssistants().items); } });
  };
  // 再次选中当前助理（点它的标签）不能取消它正在打开的会话，否则「正在读取助理会话…」不会结束（PA-TAB-01）
  const select = (item: PersonalAssistant) => { if (item.id === selected) return; generation.current++; storeAssistant(loadAssistants().items.find(x => x.id === item.id) ?? item); setSelected(item.id); };
  // PA-DELETE / PA-TAB-01：标签 × 与底部按钮都在确认后真正删除这位助理（会话归档可找回，文档目录保留）
  const remove = (item: PersonalAssistant) => confirm({
    title: `删除助理「${item.name}」？`, okText: '删除', danger: true,
    desc: '会删除它的定时任务、解除飞书绑定，并把它的对话移到「归档的任务」（可以找回）。助理文档保留在本机。',
    onOk: () => {
      const owner = account, at = items.findIndex(x => x.id === item.id); setBusy(true);
      void deleteAssistant(item).then(() => {
        if (owner !== s.account?.id) return;
        update(st => { delete st.drafts[`personal:${item.id}`]; delete st.attachments[`personal:${item.id}`]; });
        const rest = loadAssistants().items; setItems(rest);
        if (item.id === current.current || !rest.some(x => x.id === current.current)) {
          generation.current++; setReadyKey(''); setError('');
          setSelected(rest[Math.min(Math.max(at, 0), rest.length - 1)]?.id ?? '');
        }
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
      <AssistantTabs items={items} selected={selected} onSelect={select} onDelete={remove} busy={busy} running={item => !!item.conversation && !!s.running[item.conversation]} />
      <Btn label="新建助理" ic="plus" variant="pill" onClick={create} disabled={busy && !a} />
      <div className="pa-window-actions"><Btn label="通话" ic="phone" disabled title="桌面AI通话尚未接入" /><IconBtn ic="minus" label="最小化" onClick={onMinimize} /><IconBtn ic="close" label="关闭个人助理" onClick={onClose} /></div>
    </header>
    <main className="pa-body"><section className="pa-conversation" aria-label="个人助理对话">
      {a && <div className="pa-chathead"><button type="button" className="pa-avatar-btn" title="更换头像" aria-label={`更换${a.name}的头像`} onClick={() => changeAvatar(a)}>
        <AssistantAvatar assistant={a} className="pa-avatar" /><span className="pa-avatar-btn__mark"><Icon name="camera" /></span>
      </button><div className="pa-chathead__text"><strong title={a.name}>{a.name}</strong>
        <button type="button" className="pa-workspace" title={a.workspace ? `工作文件夹：${a.workspace}` : undefined} aria-label={`工作文件夹：${folderLabel(a)}，点击更换`} disabled={!c || busy} onClick={() => void folder()}><Icon name="folder" /><span>{folderLabel(a)}</span></button>
      </div></div>}
      <div className="pa-messages" ref={stick.ref} onScroll={stick.onScroll}>
        {error && <div className="pa-error" role="alert">{error}<Btn label="重新同步并重试" size="sm" onClick={() => { void refreshTaskList().then(() => setRetry(x => x + 1), e => toastError('重新同步失败', new Error(personalError(e)))); }} /></div>}
        {s.conn !== 'ready' && <p className="pa-muted">{s.conn === 'offline' ? '核心未连接，恢复连接后继续。' : '正在连接核心…'}</p>}
        {busy && <p className="pa-muted"><Spinner size={16} /> 正在读取助理会话…</p>}
        {!a ? <div className="pa-empty"><AssistantAvatar assistant={{}} className="pa-avatar" /><h1>你的个人助理</h1><p>每位助理都有自己的对话、文档和记忆。</p><Btn label="新建助理" ic="plus" variant="primary" onClick={create} disabled={busy} /></div>
          : c ? <><MessageList msgs={c.messages} ctxId={c.id} />{s.running[c.id] && <ReplyPending c={c} />}{!c.messages.length && <div className="pa-empty"><h1>你好，我是{a.name}</h1><p>从一句话开始，我们在这里继续。</p></div>}</> : null}
      </div>
      {a && <div className="pa-composer">{c && !busy && !error ? <Composer ckey={`personal:${a.id}`} agentId="pc" compact note={false} toolbar={false} placeholder={`给${a.name}发消息…`} /> : <div className="pa-composer-placeholder">{error ? '会话打开后可以发送消息' : s.conn === 'offline' ? '核心恢复连接后可以发送消息' : '正在打开会话…'}</div>}</div>}
    </section>
    <aside className="pa-inspector" aria-label="助理管理"><div className="pa-inspector__scroll">
      {a ? <><section className="pa-section"><h2>通道连接</h2><FeishuConnect key={`feishu:${account}:${a.id}`} assistant={a} /></section>
        <PersonalMcp key={`mcp:${account}:${a.id}`} assistant={a} /><PersonalPermissions key={`permissions:${account}:${a.id}`} assistant={a} />{c && <PersonalSchedules key={`tasks:${a.id}`} assistant={a} />}<PersonalDocuments key={`docs:${a.id}`} assistant={a} /><section className="pa-section"><Btn label="删除这位助理" ic="trash" variant="danger-ghost" size="sm" disabled={busy || (!!a.conversation && !!s.running[a.conversation])} onClick={() => remove(a)} /></section></>
        : <section className="pa-section"><p className="pa-muted">新建助理后，可以在这里连接飞书，设置权限和定时任务，查看文档、记忆与日记。</p></section>}
    </div><footer><Icon name="info" />会话、文档和记忆独立保存 · 通话尚未接入</footer></aside></main>
  </div>;
}
