import { cloudConfigured } from '@/features/account/runtime/serviceConfig';
import { ImportedHistoryRows } from '@/features/history/ui/ImportedHistoryRows';
import { beginConversationDrag, refreshHistory } from '@/features/history/runtime/historyImport';
import { HistoryHeader } from '@/features/chat/ui/HistoryHeader';
import { HistoryIcon } from '@/shared/ui/HistoryIcon';
import { desktopHistory, historySourceId, historyAgentId } from '@/state/history';
import { t } from '@/shared/i18n/index';
import { dragWindow } from '@/core/platform';
import { foldGroup, newGroup, pinConv, toggleConvSearch } from '@/features/chat/actions/conversations';
import { newTeam } from '@/features/teams/actions/teams';
import { toggleLeft } from './layout';
import { go, goBack, newTask, openConv, setMode } from '../navigation';
import { feedback } from '@/features/settings/actions/settings';
import { unreadFeedback } from '@/features/account/runtime/feedback';
import { openMenu, openPalette } from '@/shared/overlays/controller';
import { pair } from '@/features/phones/actions/phone';
import { settingsPage } from '@/features/settings/actions/settings';
import { Avatar, DeviceButton } from '@/shared/ui/Agent';
import { IconBtn, NavItem } from '@/shared/ui/Button';
import { Kbd, Seg, Spinner } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { Search } from '@/shared/ui/Layout';
import { agentRow, loadAgents, logoUrl } from '@/features/settings/runtime/agents';
import { convsOf, phone } from '@/state/selectors';
import { S, update, useStore } from '@/state/store';
import { useEffect } from 'react';
import type { Conv } from '@/state/types';
import { cx } from '@/shared/lib/util';

/* ===== 左侧栏：电脑模式 / 手机模式 / 设置 ===== */

export const SETTING_PAGES: [string, string, string][] = [['account', '账号', 'person'], ['general', '通用', 'settings'], ['agents', 'Agents', 'compass'], ['models', '模型与额度', 'cube'], ['connections', '手机与连接', 'phone'], ['agent', 'Agent 默认配置', 'people'], ['security', '权限与安全', 'shield'], ['data', '数据与备份', 'database']];

/** 顶部：macOS 红绿灯位置留空（桌面外壳里由系统绘制）+ 搜索 + 收起 */
function SidebarTop() {
  return (
    <div className="sidebar__top" onMouseDown={dragWindow}>
      <div className="traffic" aria-hidden="true"><span className="r" /><span className="y" /><span className="g" /></div>
      <IconBtn ic="search" label="搜索（⌘K）" onClick={openPalette} size="sm" />
      <IconBtn ic="sidebar" label="收起侧栏（⌘B）" onClick={toggleLeft} size="sm" />
    </div>
  );
}

const Brand = () => <div className="brand"><img src="/logo.png" alt="Lom" /><span>Lom</span></div>;

function ModeSwitch() {
  const s = useStore();
  return (
    <div className="mode-switch">
      <Seg variant="brand" block value={s.mode} onChange={setMode} options={[
        { value: 'desktop', label: '电脑', ic: 'monitor' },
        { value: 'phone', label: '手机', ic: 'phone', addon: <IconBtn ic="plus" label="添加手机（扫码配对）" onClick={pair} size="sm" className="seg__addon" /> },
      ]} />
    </div>
  );
}

function SidebarFoot() {
  const s = useStore();
  return (
    <div className="sidebar__foot">
      <button type="button" className="account" aria-label="账号菜单" onClick={e => openMenu('account', e.currentTarget)}>
        <Avatar agent={{ kind: 'user', avatar: s.account?.avatar, name: s.account?.name || s.account?.email || '未' }} />
        <span className="grow">
          <div className="account__name">{s.account ? s.account.name || s.account.email : cloudConfigured() ? '未登录' : '开源社区版'}</div>
          <div className="account__sub">{!cloudConfigured() ? '自带 API Key · 云端后端未包含' : s.conn !== 'ready' ? (s.conn === 'connecting' ? '正在连接核心服务…' : '核心服务未连接') : s.points ? `积分 ${s.points.total} 点` : s.cloud === 'signing-in' ? '正在登录…' : '登录 HEANG 账号'}</div>
        </span>
      </button>
      <span className="dot-anchor">
        <IconBtn ic="settings" label={unreadFeedback() ? '设置（反馈有新回复）' : '设置'} onClick={() => (unreadFeedback() ? feedback() : go('settings'))} />
        {unreadFeedback() > 0 && <span className="dot-red" aria-hidden="true" />}
      </span>
    </div>
  );
}

/* 会话行（电脑任务、手机会话共用） */
/** 电脑任务左边的图标：用这个任务所用 Agent 的图标（Lom 任务用 Lom 的） */
function ConvLogo({ c }: { c: Conv }) {
  const row = c.agentId ? agentRow(c.agentId) : undefined;
  const src = c.agentId ? logoUrl(row?.icon) : '/logo.png';
  return <HistoryIcon src={src} name={c.title} lom={!c.agentId} running={!!S.running[c.id]} />;
}

function ConvRow({ c }: { c: Conv }) {
  const s = useStore();
  const active = s.route.name === 'chat' && s.activeConv === c.id;
  return (
    <div draggable onDragStart={e => beginConversationDrag(e.dataTransfer, c.id)} className={cx('conv', active && 'is-active')} style={c.owner === 'pc' ? { paddingLeft: 4 } : undefined}>
      <button type="button" className={cx('conv__name', c.owner === 'pc' && 'conv__name--desktop')} onClick={() => openConv(c.id)} title={c.title}>{c.owner === 'pc' && <ConvLogo c={c} />}<span className="conv__title">{c.title}</span></button>
      {c.owner !== 'pc' && s.running[c.id] && <span className="conv__state" role="status" aria-label="正在运行"><Spinner size={12} /></span>}
      {c.pinned && c.owner !== 'pc' && <IconBtn ic="pin" label="取消置顶" onClick={() => pinConv(c.id)} size="sm" className="is-pinned" />}
      <IconBtn ic="more" label="会话选项" onClick={e => openMenu('conv', e.currentTarget, { id: c.id, key: `conv${c.id}`, align: 'end' })} size="sm" />
    </div>
  );
}

export function DesktopSidebar() {
  const s = useStore();
  const r = s.route.name;
  const tasks = desktopHistory().filter(c => (c.agentId || '') === historyAgentId());
  useEffect(() => { if (s.conn === 'ready') void refreshHistory().catch(error => {
    // Older sidecars have no archive API: retain explicit feedback in the import dialog.
    update(st => { st.historyImports = []; st.historyImportError = error instanceof Error ? error.message : String(error); });
  }); }, [s.conn]);
  const hasImported = s.historyImports.some(e => historySourceId(e.source) === historyAgentId());
  const needsLogos = s.historyImports.length > 0 || s.agentPins.length > 0 || desktopHistory().some(c => c.agentId);
  // 外部 Agent 任务的图标来自 Agent 列表：还没读过就读一次
  useEffect(() => { if (needsLogos && !S.agentCatalog) void loadAgents(); }, [needsLogos]);
  return (
    <aside className="sidebar" aria-label="侧边栏">
      <SidebarTop /><Brand /><ModeSwitch />
      <div className="sidebar__body">
        <div className="sidebar__section">
          <NavItem label="新的任务" ic="plus" onClick={newTask} active={r === 'home'} trail={<Kbd k="⌘N" />} />
          <NavItem label="定时任务" ic="clock" onClick={() => go('schedule')} active={r === 'schedule'} trail={s.schedules.filter(x => x.enabled).length} />
          <NavItem label="skillhub" ic="grid" onClick={() => go('skillhub')} active={r === 'skillhub'} />
          <NavItem label="OPC团队" ic="people" onClick={() => go('teams')} active={r === 'teams'} />
        </div>
        {s.teams.length > 0 && (
          <div className="sidebar__section">
            <div className="sidebar__label"><span>{t('我的团队')}</span><IconBtn ic="plus" label="新建团队" onClick={newTeam} size="sm" /></div>
            {s.teams.map(t => <NavItem key={t.id} label={t.name} ic="people" size="sm" onClick={() => go('team', t.id)} active={r === 'team' && s.route.id === t.id} trail={String(t.members.length)} />)}
          </div>
        )}
        <div className="sidebar__section">
          <HistoryHeader />
          {<ImportedHistoryRows />}{tasks.length
            ? tasks.map(c => <ConvRow key={c.id} c={c} />)
            : hasImported ? null : <div className="muted" style={{ fontSize: 13, padding: 8 }}>{s.conn === 'ready' ? '这个 Agent 还没有历史会话' : s.conn === 'connecting' ? '正在连接…' : '核心服务未连接'}</div>}
        </div>
      </div>
      <SidebarFoot />
    </aside>
  );
}

export function PhoneSidebar() {
  const s = useStore();
  const p = phone();
  const r = s.route.name;
  const list = convsOf(p.id).filter(c => !s.q.conv || c.title.includes(s.q.conv));
  const day = 24 * 3600e3, today0 = new Date().setHours(0, 0, 0, 0);
  const rest = list.filter(c => !c.pinned && !s.convGroup[c.id]);
  const groups: { key: string; name: string; custom?: boolean; items: Conv[] }[] = [
    { key: 'pinned', name: '置顶', items: list.filter(c => c.pinned) },
    ...(s.customGroups[p.id] || []).map(g => ({ key: g.id, name: g.name, custom: true, items: list.filter(c => !c.pinned && s.convGroup[c.id] === g.id) })),
    { key: 'today', name: '今天', items: rest.filter(c => c.updated >= today0) },
    { key: 'yesterday', name: '昨天', items: rest.filter(c => c.updated < today0 && c.updated >= today0 - day) },
    { key: 'earlier', name: '更早', items: rest.filter(c => c.updated < today0 - day) },
  ];
  const nav = (label: string, ic: string, route: string) => <NavItem key={route} label={label} ic={ic} onClick={() => go(route)} active={r === route} />;
  return (
    <aside className="sidebar" aria-label="侧边栏">
      <SidebarTop /><Brand /><ModeSwitch />
      <div className="sidebar__body">
        <DeviceButton phone={p} variant="sidebar" />
        <div className="sidebar__section" style={{ borderTop: 0, paddingTop: 2 }}>
          {nav('定时任务', 'clock', 'phone-schedule')}{nav('技能', 'grid', 'phone-skills')}{nav('子代理', 'people', 'phone-subagents')}{nav('人格 · SOUL.md', 'person', 'phone-soul')}{nav('记忆', 'database', 'phone-memory')}
        </div>
        <div className="sidebar__section">
          <div className="sidebar__label">
            <span>{t('会话')}</span>
            <span className="row" style={{ gap: 2 }}>
              <IconBtn ic="search" label="搜索会话" onClick={toggleConvSearch} size="sm" active={s.convSearch} />
              <IconBtn ic="plus" label="新建会话" onClick={newTask} size="sm" />
            </span>
          </div>
          {s.convSearch && <div style={{ padding: '0 4px 8px' }}><Search bind="q.conv" placeholder="搜索会话…" autoFocus /></div>}
          {groups.filter(g => g.items.length || g.custom || g.key === 'pinned' || g.key === 'today').map(g => {
            const fk = `${p.id}:${g.key}`, folded = !!s.groupFold[fk];
            return (
              <div key={g.key}>
                <div className="row" style={{ gap: 0 }}>
                  <button type="button" className={cx('group-head', folded && 'is-folded')} onClick={() => foldGroup(fk)} aria-expanded={!folded}><Icon name="chevron" /><span>{g.custom ? g.name : t(g.name)}</span><span className="muted">({g.items.length})</span></button>
                  {g.custom && <IconBtn ic="more" label="分组选项" onClick={e => openMenu('group', e.currentTarget, { id: g.key, key: `grp${g.key}`, align: 'end' })} size="sm" />}
                </div>
                {!folded && g.items.map(c => <ConvRow key={c.id} c={c} />)}
                {!folded && g.custom && !g.items.length && <div className="muted" style={{ fontSize: 13, padding: '4px 20px 8px' }}>从会话菜单「移动到分组」放进来</div>}
              </div>
            );
          })}
          <NavItem label="新建分组" ic="plus" size="sm" onClick={() => newGroup()} />
        </div>
      </div>
      <SidebarFoot />
    </aside>
  );
}

export function SettingsSidebar() {
  const s = useStore();
  return (
    <aside className="sidebar settings-nav" aria-label="设置导航">
      <SidebarTop /><Brand /><div className="settings-title">{t('设置')}</div>
      <div className="sidebar__body">
        {SETTING_PAGES.map(([id, label, ic]) => <NavItem key={id} label={label} ic={ic} onClick={() => settingsPage(id)} active={s.settingsPage === id} />)}
        <div className="sidebar__section" style={{ marginTop: 12 }}><NavItem label="关于 Lom" ic="info" onClick={() => settingsPage('about')} active={s.settingsPage === 'about'} /></div>
      </div>
      <div className="sidebar__foot"><NavItem label="返回" ic="back" onClick={goBack} /></div>
    </aside>
  );
}
