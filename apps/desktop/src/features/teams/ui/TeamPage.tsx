import { useEffect } from 'react';
import { addMember, clearPane, fillTeamDraft, focusTeamMember, paneMax, stopTeam, stopTeamState } from '../actions/teams';
import { go, openConv } from '@/app/navigation';
import { openMenu } from '@/shared/overlays/controller';
import { wsTab } from '@/app/shell/layout';
import { Chip } from '@/shared/ui/Agent';
import { Btn, IconBtn } from '@/shared/ui/Button';
import { Seg, Typing } from '@/shared/ui/Controls';
import { Empty } from '@/shared/ui/Layout';
import { agent, team } from '@/state/selectors';
import { conversationOf, memberInfo, teamFolder } from '../runtime/team';
import { openTask } from '@/features/chat/runtime/tasks';
import { watchPhone } from '@/features/phones/runtime/phoneChat';
import { loadConvOptions } from '@/features/settings/runtime/agentOptions';
import { ReplyPending } from '@/features/chat/ui/ReplyPending';
import { MemberWait } from './MemberWait';
import { memberWait } from '../activity/memberWait';
import { MemberAvatar } from './MemberAvatar';
import { TeamEmptyState } from './TeamEmptyState';
import { TeamActivityView } from '../activity/TeamActivityView';
import { S, update, useStore } from '@/state/store';
import type { Team, TeamMember } from '@/state/types';
import { cx } from '@/shared/lib/util';
import { useStickBottom } from '@/features/chat/ui/Chat';
import { Composer } from '@/features/chat/ui/Composer';
import { MessageList } from '@/features/chat/ui/MessageList';

/* ===== D33 团队页：并排 / 看板 / 单个，原宫格由看板完整替代 ===== */

function Pane({ t, m, focus }: { t: Team; m: TeamMember; focus: boolean }) {
  const s = useStore();
  const info = memberInfo(m.agent);
  const stick = useStickBottom<HTMLDivElement>();
  const key = `team:${t.id}:${m.mid}`;
  const c = t.real ? conversationOf(t, m) : undefined;
  const msgs = t.real ? c?.messages ?? [] : t.panes[m.mid] || [];
  const running = c ? !!s.running[c.id] : !!s.running[key];
  const phone = info.kind === 'phone';
  useEffect(() => { if (c?.remote) void openTask(c.id); else if (c?.phoneSession) void watchPhone(c); }, [c?.id]);
  // 本机 Agent 成员：读一次它会话里的模型，输入框右下角才能显示和切换
  useEffect(() => { if (c?.agentId && !S.agentOptions[c.id]) void loadConvOptions(c); }, [c?.id]);
  const marked = focus && s.teamView !== 'single';
  return (
    <section className={cx('pane', marked && 'is-focus')} aria-label={`${info.name} ${m.role}`} data-member-id={m.mid} aria-current={marked ? 'true' : undefined}>
      <header className="pane__head">
        <MemberAvatar id={m.agent} size="sm" crown={m.leader} status={phone} />
        <div className="grow" style={{ minWidth: 0 }}><div className="pane__name" title={`${info.name} · ${m.role}`}>{info.name} · {m.role}</div><div className="pane__role" title={m.leader ? 'Leader · 先开图，再分工' : info.note}>{m.leader ? 'Leader · 先开图，再分工' : info.note}</div></div>
        {!t.real && <IconBtn ic="refresh" label="清空此成员对话" onClick={() => clearPane(t.id, m.mid)} size="sm" />}
        {c && <IconBtn ic="external" label="在任务里打开" onClick={() => openConv(c.id)} size="sm" />}
        <IconBtn ic={s.teamView === 'single' ? 'compress' : 'expand'} label={s.teamView === 'single' ? '退出单个视图' : '只看这个成员'} onClick={() => paneMax(m.mid)} size="sm" />
      </header>
      <MemberWait c={c} />
      <div className="pane__scroll" ref={stick.ref} onScroll={stick.onScroll}>
        {!t.real && <div className="msg__sys">团队里有示例手机，以下记录仅为示例。</div>}
        {msgs.length ? <MessageList msgs={msgs} ctxId={c ? `conv:${c.id}` : key} />
          : <div className="pane__empty"><TeamEmptyState
            member={{ name: info.name, memberId: m.mid, agentId: m.agent, leader: !!m.leader }}
            onSuggest={(text) => fillTeamDraft(t.id, m.mid, text)}
          /></div>}
        {running && !memberWait(c) && (c ? <ReplyPending c={c} /> : <div className="msg__sys"><Typing />{info.name} 正在处理…</div>)}
      </div>
      <div className="pane__foot"><Composer ckey={key} compact agentId={phone ? m.agent : undefined} placeholder={m.leader ? `把目标告诉 Leader（${info.name}）…` : `直接发给 ${info.name} · ${m.role}…`} /></div>
    </section>
  );
}

/** 顶栏成员标签：选中后定位到它的看板列或并排窗格（TEAM-FOCUS-01） */
function MemberTab({ t, m, selected }: { t: Team; m: TeamMember; selected: boolean }) {
  const a = agent(m.agent), pick = () => focusTeamMember(t.id, m.mid);
  const name = `${a ? a.name : memberInfo(m.agent).name} · ${m.role}`;
  if (a) return <Chip agent={a} title={name} tooltip={name} variant="tab" selected={selected} crown={m.leader} onClick={pick} />;
  return <Btn label={name} title={name} variant={selected ? 'secondary' : 'ghost'} active={selected} size="sm" onClick={pick} />;
}

export function TeamPage() {
  const s = useStore();
  const t = team(s.route.id);
  if (!t) return <Empty ic="people" title="团队不存在" actions={<Btn label="返回团队列表" onClick={() => go('teams')} />} />;

  const board = s.teamView === 'board';
  const focus = t.members.find(m => m.mid === s.teamFocus) ?? t.members[0];
  const shown = s.teamView === 'single' && focus ? [focus] : t.members;
  const stop = stopTeamState(t), stopNote = `team-stop-note-${t.id}`;
  return (
    <div className="team">
      <div className="team__bar">
        <div className="team__members" role="group" aria-label="团队成员">{t.members.map(m => <MemberTab key={m.mid} t={t} m={m} selected={focus?.mid === m.mid} />)}</div>
        <Btn label="停止团队" ic="stop" size="sm" disabled={!stop.enabled} title={stop.hint} aria-describedby={stop.enabled ? undefined : stopNote} onClick={() => stopTeam(t.id)} />
        {!stop.enabled && <span id={stopNote} className="team__stop-note">{stop.hint}</span>}
        <Btn label="管理成员" ic="userPlus" variant="ghost" size="sm" onClick={() => addMember(t.id)} />
        <Seg label="团队视图" size="sm" options={[{ value: 'side', ic: 'columns', label: '并排', title: '并排' }, { value: 'board', ic: 'kanban', label: '看板', title: '看板' }, { value: 'single', ic: 'square', label: '单个', title: '单个' }]} value={s.teamView} onChange={v => update(x => { x.teamView = v; })} />
        {/* D33-UX-03：成员共用团队文件夹，直接在右侧文件面板里看，不再只弹一行路径 */}
        <IconBtn ic="folder" label={`团队文件：${teamFolder(t)}`} onClick={() => wsTab('files')} />
        <IconBtn ic="more" label="团队选项" onClick={e => openMenu('team', e.currentTarget, { id: t.id, align: 'end' })} />
      </div>
      {board
        ? <TeamActivityView team={t} focusMemberId={focus?.mid} />
        : <div className={`team__panes team__panes--${s.teamView}`}>{shown.map(m => <Pane key={m.mid} t={t} m={m} focus={focus?.mid === m.mid} />)}</div>}
    </div>
  );
}
