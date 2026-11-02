import { personalPermissionLabel } from '@/features/personal/runtime/permissions';
import { avatarUrl } from '@/features/personal/runtime/avatars';
import { visibleReply } from '../runtime/commands';
import { MemberAvatar } from '@/features/teams/ui/MemberAvatar';
import { agentRow } from '@/features/settings/runtime/agents';
import { openMessagePath } from '@/features/workspace/runtime/workspace';
import { ReplyImage } from '@/shared/ui/ReplyImage';
import { UserMessage } from './UserMessage';
import { EventCard } from './EventCard';
import { QuestionMessage } from './QuestionMessage';
import { permissionChoice } from '../runtime/permissionOptions';
import { approvePermissionOption } from '../runtime/permissions';
import { ToolCalls } from './ToolCalls';
import { approve } from '../actions/composer';
import { toggleEvent } from '../actions/conversations';
import { watchPhone, wsTab } from '@/app/shell/layout';
import { enterPhone, go } from '@/app/navigation';
import { Avatar } from '@/shared/ui/Agent';
import { Btn } from '@/shared/ui/Button';
import { Badge, Spinner, Typing } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { IconTile } from '@/shared/ui/Layout';
import { Markdown } from '@/shared/ui/Markdown';
import { agent, conv, modelName, perm } from '@/state/selectors';
import { useStore } from '@/state/store';
import type { Msg } from '@/state/types';
import { cx, fmtTime } from '@/shared/lib/util';

/* ===== 消息（对话页、团队窗格共用） ===== */

/** CW06：工具调用把一条回复切成几段时，代码围栏在段间的接续状态（由 MessageList 按整轮算出） */
export type FenceCarry = { from?: number; openEnd?: boolean };

export function Message({ m, ctxId, continued = false, headerOnly = false, compactThinking = false, thinkingActive = false, fence }: { m: Msg; ctxId: string; continued?: boolean; headerOnly?: boolean; compactThinking?: boolean; thinkingActive?: boolean; fence?: FenceCarry }) {
  const s = useStore();
  const open = !!s.eventOpen[m.id];
  const messageConv = conv(ctxId.replace(/^conv:/, ''));
  switch (m.type) {
    case 'user': return <UserMessage m={m} ctxId={ctxId} />;
    case 'assistant': {
      // Older cached phone messages have no per-message identity; use their conversation owner.
      const conversation = messageConv;
      const external = conversation?.agentId ? agentRow(conversation.agentId) : undefined;
      const source = m.agent ?? conversation?.owner ?? 'pc';
      const a = agent(source) ?? {
        kind: conversation?.phoneSession || source.startsWith('dev_') ? 'phone' as const : 'user' as const,
        name: conversation?.phoneSession || source.startsWith('dev_') ? '手机 Agent' : 'Agent',
        real: true, model: undefined,
      };
      const imageContext = { account: s.account?.id || 'local', conversation: ctxId, message: m.remoteId || m.id.split(':block:')[0],
        workspace: conversation?.workspace, ...(conversation?.phoneSession ? { phone: { device: conversation.owner, session: conversation.phoneSession } } : {}) };
      return (
        <div className={cx('msg', continued && 'msg--cont')}>
          {continued ? <span className="msg__gutter" aria-hidden="true" /> : conversation?.personal ? <img className="pa-message-avatar" src={avatarUrl(conversation.personal.avatar)} alt={`${conversation.personal.name}头像`} /> : conversation?.agentId ? <MemberAvatar id={`ag:${conversation.agentId}`} name={conversation.agentName} size="sm" /> : <Avatar agent={a} size="sm" />}
          <div className="msg__body">
            {!continued && <div className="msg__meta"><span className="msg__name">{conversation?.agentId ? external?.name || conversation.agentName || 'Agent' : conversation?.personal?.name || m.role || a?.name}</span>{a?.kind === 'phone' && !a.real && <Badge text={modelName(a.model || 'lom-mini')} />}<span>{fmtTime(m.at)}</span></div>}
            {!headerOnly && <><div className="msg__text"><Markdown text={visibleReply(m.text, m.streaming)} streaming={m.streaming} fenceFrom={fence?.from} fenceOpenEnd={fence?.openEnd} file={conversation?.remote && !conversation.phoneSession ? (path, label, key) => <button key={key} type="button" className="message-path" title={`在侧栏打开：${path}`} onClick={() => void openMessagePath(path, conversation.workspace)}>{label}</button> : undefined} image={(source, alt, key) => <ReplyImage key={`${imageContext.account}:${ctxId}:${key}:${source}`} source={source} alt={alt} context={imageContext} ready={!m.streaming} />} />{m.streaming && <Typing inline />}</div>
            {m.attachments?.filter(a => a.phoneFile && /\.(png|jpe?g|webp|gif)$/i.test(a.name)).map((a, i) => <ReplyImage key={`${imageContext.account}:${ctxId}:attachment-${i}`} source={a.name} alt={a.name}
              context={{ ...imageContext, attachment: { session_id: a.phoneFile!.session, message_id: a.phoneFile!.message, index: String(a.phoneFile!.index) } }} ready={!m.streaming} />)}</>}
          </div>
        </div>
      );
    }
    case 'thinking':
      if (compactThinking) return <div className="lom-thinking">
        <button type="button" className="lom-thinking__head" onClick={() => toggleEvent(m.id)} aria-expanded={open}>
          <span className="thinking-state" title={thinkingActive ? '正在思考' : '思考已完成'}>{thinkingActive ? <Spinner size={14} /> : <Icon name="check" />}</span>
          <span>{thinkingActive ? '正在思考…' : '思考过程'}</span>
          <Icon name="chevron" className={cx('tools__chev', open && 'is-open')} />
        </button>
        {open && <div className="lom-thinking__body msg__text"><Markdown text={m.text || '暂无思考内容'} /></div>}
      </div>;
      // CW06：和桌面紧凑思考同一套 Markdown 规则，换行与列表不再被收成一行空格
      return <EventCard m={m} ic="sparkles" title="思考过程" sub={open ? '' : `${(m.text || '').slice(0, 40)}…`} body={m.text ? <div className="msg__text"><Markdown text={m.text} /></div> : undefined} />;
    case 'plan': {
      const items = m.items || [], done = items.filter(i => i.done).length;
      return (
        <div className={cx('event', done === items.length && 'event--brand')}>
          <div className="event__head"><IconTile ic="flag" /><span className="event__title">执行计划<small>{done}/{items.length} 已完成</small></span></div>
          <ul className="plan">{items.map((it, i) => <li key={i} className={it.done ? 'is-done' : i === done ? 'is-doing' : ''}><span className="plan__box">{it.done && <Icon name="check" />}</span>{it.text}</li>)}</ul>
        </div>
      );
    }
    case 'tool':
      return <ToolCalls items={[m]} ctxId={ctxId} />;
    case 'question': return <QuestionMessage m={m} ctxId={ctxId} />;
    case 'approval': {
      const pending = m.status === 'pending', submitting = m.status === 'submitting';
      const title = submitting ? '正在提交决定…' : pending ? '需要你的确认' : m.status === 'approved' ? '已允许' : m.status === 'denied' ? '已拒绝' : m.confirmationSubmitted ? '已提交权限选项' : '请求已处理，决定未知';
      const real = !!messageConv?.remote;
      const supported = !real || !!m.confirmationOptions?.length;
      const sideReadOnly = !!messageConv?.sideOf;
      const choices = m.confirmationOptions?.filter(o => o.action === 'choice');
      return (
        <EventCard m={m} tone="warn" ic="shield" title={title} sub={m.command} toggle={false}
          foot={pending || submitting ? <>
            <span className="muted grow">{sideReadOnly ? '侧边聊天只读：不会请求你放权' : supported ? `权限模式：${messageConv?.personal ? personalPermissionLabel(messageConv) : perm(s.permission).name}` : m.confirmationProblem || '核心未提供可识别的权限选项；未允许任何操作，请停止任务后重试。'}</span>
            {sideReadOnly
              ? <Btn label="拒绝" variant="ghost" size="sm" disabled={submitting} onClick={() => approve(ctxId, m, '0')} />
              : choices?.length ? choices.map((o, i) => <Btn key={i} label={o.label} size="sm" disabled={submitting} onClick={() => void approvePermissionOption(ctxId.replace(/^conv:/, ''), m, o.value)} />) : <>
              <Btn label="拒绝" variant="ghost" size="sm" disabled={submitting || (real && !permissionChoice(m, 'deny'))} onClick={() => approve(ctxId, m, '0')} />
              <Btn label="总是允许" variant="secondary" size="sm" disabled={submitting || (real && !permissionChoice(m, 'always'))} onClick={() => approve(ctxId, m, 'always')} />
              <Btn label="允许一次" variant="primary" size="sm" disabled={submitting || (real && !permissionChoice(m, 'once'))} onClick={() => approve(ctxId, m, '1')} />
              </>}
          </> : undefined} />
      );
    }
    case 'files':
      return (
        <EventCard m={m} tone="info" ic="fileCode" title={`修改了 ${m.changes?.length ?? 0} 个文件`} sub={m.changes?.map(c => c.path).join('、')}
          body={m.changes?.map(c => <div key={c.path} className="diff-row"><Icon name="file" /><span className="grow">{c.path}</span><span className="add">+{c.add}</span><span className="del">−{c.del}</span></div>)}
          foot={<Btn label="在工作区查看" ic="eye" variant="ghost" size="sm" onClick={() => wsTab('files')} />} />
      );
    case 'delegate': {
      const p = agent(m.to ?? '');
      if (!p) return null;
      return (
        <EventCard m={m} tone="brand" ic="phone" title={`已委派给 ${p.name}`} sub={m.task} toggle={false}
          foot={<>
            {m.status === 'running' ? <><Spinner /><span className="muted grow" style={{ fontSize: 13 }}>手机正在执行…</span></> : <span className="muted grow" style={{ fontSize: 13 }}>{m.status === 'queued' ? '手机离线，上线后自动执行' : '手机已完成'}</span>}
            <Btn label="看手机画面" ic="eye" variant="ghost" size="sm" onClick={() => watchPhone(p.id)} />
            <Btn label="打开手机对话" ic="message" variant="ghost" size="sm" onClick={() => enterPhone(p.id)} />
          </>} />
      );
    }
    case 'teammate':
      // OPC 团队里别的成员发来的消息（内核 team_send_message）
      return (
        <div className="event event--brand teammate-msg">
          <div className="event__head"><IconTile ic="message" /><span className="event__title">来自 {m.agent} 的消息</span></div>
          <div className="event__body msg__text"><Markdown text={m.text || ''} /></div>
        </div>
      );
    case 'handoff': {
      const p = agent(m.phone ?? '');
      if (!p) return null;
      const idx = ['help', 'takeover', 'returned'].indexOf(m.stage || 'help');
      const step = (i: number, label: string, ic: string) => <span className={cx('handoff__step', (i < idx || m.stage === 'returned') && 'is-done', i === idx && m.stage !== 'returned' && 'is-now')}><Icon name={ic} />{label}</span>;
      return (
        <div className="event event--warn">
          <div className="event__head">
            <IconTile ic="hand" />
            <span className="event__title">{p.name} 求助 · 大小模型交接<small>{m.note}</small></span>
            {m.stage === 'takeover' ? <Badge text="总指挥接管中" tone="warn" /> : m.stage === 'returned' ? <Badge text="已交还" tone="ok" /> : null}
          </div>
          <div className="handoff">
            {step(0, '手机求助', 'help')}<span className="handoff__arrow"><Icon name="chevronRight" /></span>
            {step(1, '总指挥接管', 'monitor')}<span className="handoff__arrow"><Icon name="chevronRight" /></span>
            {step(2, '交还手机', 'phone')}<span className="grow" />
            <Btn label="看手机画面" ic="eye" variant="ghost" size="sm" onClick={() => watchPhone(p.id)} />
          </div>
        </div>
      );
    }
    case 'schedule':
      return <EventCard m={m} tone="info" ic="clock" title={m.title} sub={m.desc} toggle={false} foot={<Btn label="查看定时任务" variant="ghost" size="sm" onClick={() => go('schedule')} />} />;
    case 'system':
      return <div className="msg__sys"><Icon name={m.ic || 'info'} />{m.text}</div>;
    default:
      return null;
  }
}
