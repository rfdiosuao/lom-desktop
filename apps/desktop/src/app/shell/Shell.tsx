import { dragWindow } from '@/core/platform';
import { useEffect, useRef, type CSSProperties, type PointerEvent as RPointerEvent, type KeyboardEvent as RKeyboardEvent } from 'react';
import { renameConv } from '@/features/chat/actions/conversations';
import { toggleLeft, toggleRight } from './layout';
import { newTask } from '../navigation';
import { AgentSwitch } from '@/features/settings/ui/AgentSwitch';
import { openMenu, openPalette, toast } from '@/shared/overlays/controller';
import { Avatar } from '@/shared/ui/Agent';
import { IconBtn } from '@/shared/ui/Button';
import { Badge } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { agent, conv, team } from '@/state/selectors';
import { update, useStore } from '@/state/store';
import { clamp, cx } from '@/shared/lib/util';
import { Chat, Home } from '@/features/chat/ui/Chat';
import { PhoneMemory, PhoneSkills, PhoneSoul, PhoneSubagents } from '@/features/phones/ui/PhonePages';
import { SchedulePage } from '@/features/schedules/ui/Schedule';
import { Settings } from '@/features/settings/ui/Settings';
import { Skillhub } from '@/features/skills/ui/Skillhub';
import { TeamsPage } from '@/features/teams/ui/Teams';
import { TeamPage } from '@/features/teams/ui/TeamPage';
import { DesktopSidebar, PhoneSidebar, SettingsSidebar } from './Sidebars';
import { Workspace } from '@/features/workspace/ui/Workspace';

/* ===== 外壳：左栏 / 中栏 / 右栏，三栏都可以拖拽改宽度，拖到很窄时自动收起 ===== */

const LIM = { left: [200, 440], right: [280, 720], centerMin: 400, collapseAt: { left: 140, right: 200 } } as const;

function CenterHeader() {
  const s = useStore();
  const r = s.route;
  let title: React.ReactNode = null, actions: React.ReactNode = null;
  if (r.name === 'chat') {
    const c = conv(s.activeConv);
    if (c) {
      title = <><Avatar agent={agent(c.owner)} size="sm" /><span className="center__title-text">{c.title}</span>{s.running[c.id] && <Badge text="执行中" tone="ok" />}</>;
      actions = <>
        <IconBtn ic="edit" label="重命名" onClick={() => renameConv(c.id)} />
        <IconBtn ic="more" label="更多" onClick={e => openMenu('conv', e.currentTarget, { id: c.id, key: 'convh', align: 'end' })} />
      </>;
    }
  } else if (r.name === 'team') {
    const t = team(r.id);
    if (t) title = <><Icon name="people" /><span className="center__title-text">{t.name}</span><span className="muted" style={{ fontWeight: 400 }}>{t.members.length} 位成员</span></>;
  }
  return (
    <header className={cx('center__header', (r.name === 'chat' || r.name === 'team') && 'has-border')} onMouseDown={dragWindow}>
      {s.layout.leftCollapsed && (
        <div className="collapsed-bar">
          <div className="traffic" aria-hidden="true"><span className="r" /><span className="y" /><span className="g" /></div>
          <IconBtn ic="sidebar" label="展开侧栏（⌘B）" onClick={toggleLeft} size="sm" />
          <IconBtn ic="newChat" label="新的任务" onClick={newTask} size="sm" />
          <IconBtn ic="search" label="搜索" onClick={openPalette} size="sm" />
        </div>
      )}
      <AgentSwitch />
      <div className="center__title">{title}</div>
      <div className="center__actions">
        {actions}
        {r.name !== 'settings' && <IconBtn ic="panelRight" label={s.layout.rightCollapsed ? '展开工作区（⌘⌥B）' : '收起工作区（⌘⌥B）'} onClick={toggleRight} size="sm" active={!s.layout.rightCollapsed} />}
      </div>
    </header>
  );
}

function Route() {
  const s = useStore();
  switch (s.route.name) {
    case 'chat': return <Chat />;
    case 'schedule': case 'phone-schedule': return <SchedulePage />;
    case 'skillhub': return <Skillhub />;
    case 'teams': return <TeamsPage />;
    case 'team': return <TeamPage />;
    case 'phone-skills': return <PhoneSkills />;
    case 'phone-subagents': return <PhoneSubagents />;
    case 'phone-soul': return <PhoneSoul />;
    case 'phone-memory': return <PhoneMemory />;
    case 'settings': return <Settings />;
    default: return <Home />;
  }
}

/** 拖拽条：左边往右拉压缩中间；拉到很窄时自动收起；双击恢复默认；方向键 ±16px，回车收起 */
function useResizers(shell: React.RefObject<HTMLDivElement | null>) {
  const drag = useRef<{ side: 'left' | 'right'; rect: DOMRect; w: number | null; collapse: boolean } | null>(null);
  const down = (side: 'left' | 'right') => (e: RPointerEvent<HTMLDivElement>) => {
    const el = shell.current;
    if (!el) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.classList.add('is-active');
    el.classList.add('is-dragging');
    drag.current = { side, rect: el.getBoundingClientRect(), w: null, collapse: false };
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current, el = shell.current;
    if (!d || !el) return;
    const other = el.querySelector(d.side === 'left' ? '.workspace' : '.sidebar');
    const otherW = other?.getBoundingClientRect().width ?? 0;
    const raw = d.side === 'left' ? e.clientX - d.rect.left : d.rect.right - e.clientX;
    const [min, max] = LIM[d.side];
    d.collapse = raw < LIM.collapseAt[d.side];
    d.w = Math.round(clamp(raw, min, Math.min(max, d.rect.width - otherW - LIM.centerMin)));
    el.style.setProperty(d.side === 'left' ? '--lw' : '--rw', `${d.collapse ? 0 : d.w}px`);
  };
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    e.currentTarget.classList.remove('is-active');
    shell.current?.classList.remove('is-dragging');
    update(s => { if (d.collapse) s.layout[`${d.side}Collapsed`] = true; else if (d.w) s.layout[d.side] = d.w; });
    if (d.collapse) toast(d.side === 'left' ? '侧栏已收起（⌘B 展开）' : '工作区已收起（⌘⌥B 展开）', d.side === 'left' ? 'sidebar' : 'panelRight');
  };
  const dbl = (side: 'left' | 'right') => () => update(s => { s.layout[side] = side === 'left' ? 276 : 380; });
  const key = (side: 'left' | 'right') => (e: RKeyboardEvent<HTMLDivElement>) => {
    const dir = side === 'left' ? 1 : -1, [min, max] = LIM[side];
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const delta = (e.key === 'ArrowRight' ? 16 : -16) * dir; update(s => { s.layout[side] = clamp(s.layout[side] + delta, min, max); }); }
    if (e.key === 'Enter') { e.preventDefault(); if (side === 'left') toggleLeft(); else toggleRight(); }
  };
  return (side: 'left' | 'right') => ({ onPointerDown: down(side), onPointerMove: move, onPointerUp: up, onPointerCancel: up, onDoubleClick: dbl(side), onKeyDown: key(side) });
}

export function Shell() {
  const s = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const resizer = useResizers(ref);
  const lay = s.layout, settings = s.route.name === 'settings';
  const style = { '--lw': `${lay.leftCollapsed ? 0 : lay.left}px`, '--rw': `${lay.rightCollapsed || settings ? 0 : lay.right}px`, '--left-panel-width': `${lay.left}px`, '--right-panel-width': `${lay.right}px` } as CSSProperties;
  useEffect(() => { document.title = '麓鸣 Lom'; }, []);
  return (
    <div ref={ref} className={cx('shell', lay.leftCollapsed && 'is-left-collapsed', lay.rightCollapsed && 'is-right-collapsed', settings && 'no-right')} style={style}>
      <div className="panel-slot panel-slot--left" inert={lay.leftCollapsed}>
        {settings ? <SettingsSidebar /> : s.mode === 'desktop' ? <DesktopSidebar /> : <PhoneSidebar />}
      </div>
      <main className="center" aria-label="主区域"><CenterHeader /><Route /></main>
      <div className="panel-slot panel-slot--right" inert={lay.rightCollapsed || settings}>
        {!settings && <Workspace />}
      </div>
      <div className="resizer resizer--left" role="separator" aria-orientation="vertical" aria-label="调整左侧栏宽度" tabIndex={0} aria-valuenow={lay.left} aria-valuemin={200} aria-valuemax={440} {...resizer('left')} />
      {!settings && <div className="resizer resizer--right" role="separator" aria-orientation="vertical" aria-label="调整工作区宽度" tabIndex={0} aria-valuenow={lay.right} aria-valuemin={280} aria-valuemax={720} {...resizer('right')} />}
    </div>
  );
}
