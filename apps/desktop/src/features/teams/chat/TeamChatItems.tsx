import type { ReactNode } from 'react';
import { openConv } from '@/app/navigation';
import { openAssistantOf } from '@/features/personal/runtime/panel';
import { MessageList } from '@/features/chat/ui/MessageList';
import { UserMessage } from '@/features/chat/ui/UserMessage';
import { stripSettingsContext } from '@/features/settings/runtime/preferences';
import { retryTeamChat } from '../actions/teamChat';
import { toastError } from '@/shared/overlays/controller';
import { Avatar } from '@/shared/ui/Agent';
import { Btn, IconBtn } from '@/shared/ui/Button';
import { Markdown } from '@/shared/ui/Markdown';
import { Icon } from '@/shared/ui/Icon';
import { fmtTime } from '@/shared/lib/util';
import type { Msg, Team, TeamChatPost } from '@/state/types';
import type { PersonalAssistant } from '@/features/personal/runtime/catalog';
import { assistantSender, EVERYONE, type ChatParticipant } from './participants';
import { ParticipantAvatar } from './ParticipantAvatar';
import type { ChatSource, Outcome, TimelineItem } from './timeline';

/* ===== TEAM-CHAT-01 群聊里的每一条：沿用聊天消息的头像列 + 正文列 ===== */

const STATE_TEXT = { pending: '投递中…', failed: '未送达', unconfirmed: '结果未确认，请进会话核对', accepted: '' } as const;
const OUTCOME_TEXT = { completed: '已完成', failed: '失败', cancelled: '已取消' } as const;
const TASK_TEXT: Record<string, string> = { pending: '待开始', in_progress: '进行中', completed: '已完成', deleted: '已删除' };
/** 没有平台终态时只说这一轮结束了，不替成员下「完成」的结论 */
const outcomeText = (o: Outcome) => (o ? OUTCOME_TEXT[o] : '这一轮已结束，结果以会话为准');

type Lookup = (key?: string, recordedName?: string) => ChatParticipant | undefined;
const nameOf = (find: Lookup, key?: string, recorded?: string) => (key === EVERYONE ? '所有人' : find(key, recorded)?.name ?? (key === 'user' ? '你' : '已移除的成员'));
/** 个人助理已删除时，发送者名字留不住，改在角色处写明信封里记下的名字（TEAM-CHAT-01E） */
const roleOf = (p?: ChatParticipant) => (p?.removed ? (p.recordedName ? `来自个人助理：${p.recordedName}` : '来自个人助理') : p?.role);

function Event({ who, find, at, recorded, children }: { who?: string; find: Lookup; at: number; recorded?: string; children: ReactNode }) {
  const p = find(who, recorded);
  return <div className="msg team-chat__event">
    {p ? <ParticipantAvatar p={p} /> : <Avatar agent={{ kind: 'user', name: nameOf(find, who) }} size="sm" />}
    <div className="msg__body">
      <div className="msg__meta"><span className="msg__name">{nameOf(find, who, recorded)}</span>{roleOf(p) && <span>{roleOf(p)}</span>}<span>{fmtTime(at)}</span></div>
      {children}
    </div>
  </div>;
}

function Deliveries({ t, post, find }: { t: Team; post: TeamChatPost; find: Lookup }) {
  const open = post.deliveries.filter(d => d.state !== 'accepted');
  if (!open.length) return null;
  return <div className="team-chat__deliveries" role="status">
    {open.map(d => <span key={d.key} className={`team-chat__delivery is-${d.state}`} title={d.error}>@{nameOf(find, d.key)} {STATE_TEXT[d.state]}{d.error ? `：${d.error}` : ''}</span>)}
    {open.some(d => d.state === 'failed') && <Btn label="重试未送达" size="sm" onClick={() => void retryTeamChat(t, post).catch(e => toastError('重试失败', e))} />}
  </div>;
}

const openSource = (src: ChatSource) => { if (!src.assistant || !openAssistantOf(src.conv.id)) openConv(src.conv.id); };
const toLine = (find: Lookup, keys: (string | undefined)[], note?: string) =>
  <div className="team-chat__note">→ {keys.map(k => `@${nameOf(find, k)}`).join(' ')}{note ? ` · ${note}` : ''}</div>;

function Post({ t, post, find }: { t: Team; post: TeamChatPost; find: Lookup }) {
  if (post.from?.kind === 'personal') return <Event who={`pa:${post.from.id}`} find={find} at={post.at} recorded={post.from.name}>
    {toLine(find, post.deliveries.map(d => d.key), `派活 · 本链第 ${post.hop ?? 1} 次`)}
    <div className="msg__text"><Markdown text={post.text} /></div>
  </Event>;
  const meta = { post: post.id, chain: post.chain, hop: 0, team: t.id, from: { kind: 'user' as const }, to: post.deliveries.map(d => ({ key: d.key, name: nameOf(find, d.key) })) };
  return <div className="team-chat__post"><UserMessage m={{ id: post.id, type: 'user', at: post.at, text: post.text, source: 'team_chat', teamChat: meta }} ctxId={`teamchat:${t.id}`} /><Deliveries t={t} post={post} find={find} /></div>;
}

function Mail({ item, find }: { item: Extract<TimelineItem, { kind: 'mail' }>; find: Lookup }) {
  const m = item.message;
  if (m.msg_type === 'idle_notification') return <Event who={item.from} find={find} at={item.at}>
    {toLine(find, [item.to], outcomeText(item.outcome))}
    {m.summary && <div className="msg__text"><Markdown text={m.summary} /></div>}
  </Event>;
  if (m.msg_type === 'shutdown_request') return <Event who={item.from} find={find} at={item.at}>{toLine(find, [item.to], '请求下线')}</Event>;
  return <Event who={item.from} find={find} at={item.at}>{toLine(find, [item.to])}<div className="msg__text"><Markdown text={stripSettingsContext(m.content)} /></div></Event>;
}

/** 回复里有待处理的授权或提问：在卡片上方写明是哪位成员在请求什么；允许/拒绝仍是成员会话里的同一张卡（01C） */
function AskingFor({ msgs, name }: { msgs: Msg[]; name: string }) {
  const ask = msgs.find(m => (m.type === 'approval' || m.type === 'question') && (m.status === 'pending' || m.status === 'submitting'));
  if (!ask) return null;
  const what = ask.type === 'question' ? '请你回答问题' : `请求你确认：${ask.command || ask.toolName || ask.tool || '一项操作'}`;
  return <div className="team-chat__asking" role="status"><Icon name="shield" />{name} {what}</div>;
}

/** directory：个人助理目录（由群聊视图每次渲染读取一次）。群聊成员优先，其余 pa: 身份按目录取当前名称和头像，不要求是群聊成员 */
export function TimelineEntry({ t, item, people, directory }: { t: Team; item: TimelineItem; people: ChatParticipant[]; directory?: PersonalAssistant[] }) {
  const find: Lookup = (key, recorded) => people.find(p => p.key === key) ?? (key?.startsWith('pa:') ? assistantSender(key.slice(3), directory, recorded) : undefined);
  switch (item.kind) {
    case 'post': return <Post t={t} post={item.post} find={find} />;
    case 'mail': return <Mail item={item} find={find} />;
    case 'task': return <Event who={item.owner} find={find} at={item.at}>
      <div className="team-chat__note">领到任务 · {TASK_TEXT[item.task.status] ?? item.task.status}</div>
      <div className="msg__text"><Markdown text={item.task.subject} /></div>
    </Event>;
    case 'report': return <Event who={item.from} find={find} at={item.at}>{toLine(find, [item.to], `派发的任务${outcomeText(item.outcome)}`)}</Event>;
    case 'direct': return <div className="team-chat__direct">
      <div className="team-chat__note">你 → @{nameOf(find, item.source.key)} · 单独对话</div>
      <UserMessage m={item.message} ctxId={`conv:${item.source.conv.id}`} />
    </div>;
    default: return <div className="team-chat__reply" data-member={item.source.key}>
      <AskingFor msgs={item.msgs} name={nameOf(find, item.source.key)} />
      <MessageList msgs={item.msgs} ctxId={`conv:${item.source.conv.id}`} actions={false} />
      <div className="team-chat__note">{item.msgs.some(m => m.type === 'assistant' || m.type === 'tool' || m.type === 'thinking') ? '' : `${nameOf(find, item.source.key)} · `}{find(item.source.key)?.role}<IconBtn ic="external" label={`进入 ${nameOf(find, item.source.key)} 的会话`} size="sm" onClick={() => openSource(item.source)} /></div>
    </div>;
  }
}
