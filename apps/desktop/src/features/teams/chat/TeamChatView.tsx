import { useEffect } from 'react';
import { openTask } from '@/features/chat/runtime/tasks';
import { ensureConversation } from '@/features/personal/runtime/session';
import { useStickBottom } from '@/features/chat/ui/Chat';
import { Composer } from '@/features/chat/ui/Composer';
import { ReplyPending } from '@/features/chat/ui/ReplyPending';
import { leaderMember } from '../runtime/team';
import { memberWait } from '../activity/memberWait';
import { MemberWait } from '../ui/MemberWait';
import { hasInFlightSend, hasUnconfirmedSend, isTaskStopping } from '@/features/chat/runtime/cancel';
import { Typing } from '@/shared/ui/Controls';
import { isWorking, memberStatus, STATUS_TEXT, type MemberStatus } from './status';
import { openMenu } from '@/shared/overlays/controller';
import { Btn, IconBtn } from '@/shared/ui/Button';
import { useStore, update } from '@/state/store';
import type { Team } from '@/state/types';
import { assistantDirectory, chatParticipants, EVERYONE, memberKey, type ChatParticipant } from './participants';
import { chatSources, teamChatTimeline } from './timeline';
import { TimelineEntry } from './TeamChatItems';
import { useTeamActivityFeed } from '../activity/useTeamActivityFeed';
import { ParticipantAvatar } from './ParticipantAvatar';
import { pickTarget } from './menus';
import { settleStalePending } from './posts';
import { chatAllowed } from '../actions/teamChat';

/* ===== TEAM-CHAT-01 群聊视图：沿用聊天界面的消息样式，多了 @ 选择接收者 =====
 * 视图只读各会话的真实状态，切换、重连都不会触发发送。群头状态、等待确认与加载动画都来自观测事实（01C）。 */

function Header({ t, people, statusOf }: { t: Team; people: ChatParticipant[]; statusOf: (key: string) => MemberStatus }) {
  return <div className="team-chat__head" role="group" aria-label="群聊成员">
    {people.map(p => { const st = statusOf(p.key); return <button key={p.key} type="button" className="team-chat__person" disabled={!!p.blocked} title={p.blocked ?? `@${p.name} · ${STATUS_TEXT[st]}`} onClick={() => pickTarget(t.id, p.key)}>
      <ParticipantAvatar p={p} /><span className="team-chat__name">{p.name}</span><span className="team-chat__role">{p.role}</span>
      <span className={`team-chat__status is-${st}`} data-status={st}>{isWorking(st) && <Typing />}{STATUS_TEXT[st]}</span>
    </button>; })}
    <Btn label="个人助理" ic="sparkles" variant="ghost" size="sm" onClick={e => openMenu('teamChatAssistant', e.currentTarget, { id: t.id, align: 'end' })} />
  </div>;
}

function Targets({ t, people }: { t: Team; people: ChatParticipant[] }) {
  const s = useStore();
  const keys = s.teamChatTargets[t.id] ?? [];
  const leader = people.find(p => p.key === memberKey(leaderMember(t)));
  const drop = (key: string) => update(x => { x.teamChatTargets[t.id] = keys.filter(k => k !== key); });
  return <div className="team-chat__targets" aria-label="发送给">
    <span className="team-chat__note">发送给：</span>
    {keys.length ? keys.map(key => { const p = people.find(x => x.key === key); if (key === EVERYONE) return <span key={key} className="team-chat__target">@所有人<IconBtn ic="close" label="不发给所有人" size="sm" onClick={() => drop(key)} /></span>; return <span key={key} className={`team-chat__target${p && !p.blocked ? '' : ' is-invalid'}`}>
      {p && <ParticipantAvatar p={p} />}@{p?.name ?? '已移除的成员'}<IconBtn ic="close" label={`不发给 ${p?.name ?? '这位成员'}`} size="sm" onClick={() => drop(key)} />
    </span>; }) : <span className="team-chat__target">{leader && <ParticipantAvatar p={leader} />}队长 {leader?.name}（默认）</span>}
  </div>;
}

export function TeamChatView({ team: t }: { team: Team }) {
  if (!chatAllowed(t)) return <section className="team-chat" aria-label="团队群聊"><div className="team-chat__empty">这个团队属于其他账号，群聊记录不显示。请切换回所属账号后查看。</div></section>;
  return <ChatBody t={t} />;
}

function ChatBody({ t }: { t: Team }) {
  const s = useStore();
  const stick = useStickBottom<HTMLDivElement>();
  const people = chatParticipants(t), directory = assistantDirectory();
  const assistant = people.find(p => p.assistant)?.assistant;
  const sources = chatSources(t, s.convs, assistant?.conversation);
  const feed = useTeamActivityFeed(t.core?.id, !!t.core, 'desc', 'all'); // 队长派活、成员互发、完成通知（核心信箱，01B）
  const items = teamChatTimeline(t, sources, feed);
  const ids = sources.map(x => x.conv.id).join(',');
  // 只读历史：成员会话按需加载；个人助理已有会话才加载，不为看群聊新建会话
  useEffect(() => { for (const x of sources) if (!x.conv.loaded) void openTask(x.conv.id, { refreshWorkspace: false }); }, [ids]);
  // 01D：重启或中途关闭留下的「投递中」按会话事实结算，不一直显示进行中
  const loaded = sources.map(x => `${x.conv.id}:${x.conv.loaded ? 1 : 0}`).join(',');
  useEffect(() => { settleStalePending(t, new Map(sources.map(x => [x.key, x.conv] as const))); }, [loaded, t.chatPosts?.length]);
  useEffect(() => {
    if (assistant?.conversation && !sources.some(x => x.assistant)) void ensureConversation(assistant).catch(e => console.warn('team.chat_assistant_unavailable', e instanceof Error ? e.message : e));
  }, [assistant?.id, assistant?.conversation]);
  const connected = s.conn === 'ready';
  const status = new Map(sources.map(x => [x.key, memberStatus(x.conv, { running: !!s.running[x.conv.id], connected,
    unsettled: hasInFlightSend(x.conv.id) || hasUnconfirmedSend(x.conv.id) || isTaskStopping(x.conv.id) })] as const));
  const statusOf = (key: string) => status.get(key) ?? 'idle';
  // 加载动画只跟随真实运行；断线时不再显示正在工作（01C）
  const running = sources.filter(x => isWorking(statusOf(x.key)));
  const waiting = sources.filter(x => memberWait(x.conv));
  const lost = sources.filter(x => statusOf(x.key) === 'disconnected');
  const nameOf = (key: string) => people.find(p => p.key === key)?.name;
  const leader = people.find(p => p.leader);
  return <section className="team-chat" aria-label="团队群聊">
    <Header t={t} people={people} statusOf={statusOf} />
    <div className="team-chat__scroll" ref={stick.ref} onScroll={stick.onScroll}>
      <div className="team-chat__inner">
        {items.length ? items.map(item => <TimelineEntry key={item.id} t={t} item={item} people={people} directory={directory} />)
          : <div className="team-chat__empty">在群聊里 @成员 安排工作；不 @ 时发给队长{leader ? ` ${leader.name}` : ''}。成员各自在自己的会话里执行。</div>}
        {running.map(x => <ReplyPending key={x.conv.id} c={x.conv} />)}
        {lost.length > 0 && <div className="team-chat__note" role="status">连接中断：{lost.map(x => nameOf(x.key)).join('、')} 的状态待核对，重连后按真实状态刷新</div>}
        {feed.error && <div className="team-chat__note" role="alert">成员协作记录读取失败：{feed.error}<Btn label="重试" size="sm" onClick={feed.retry} /></div>}
      </div>
    </div>
    <div className="team-chat__foot">
      {waiting.map(x => <MemberWait key={x.conv.id} c={x.conv} name={nameOf(x.key)} />)}
      <Targets t={t} people={people} />
      <Composer ckey={`teamchat:${t.id}`} toolbar={false} controls={false} note={false} placeholder="在群聊里发言，输入 @ 选择接收成员…" />
    </div>
  </section>;
}
