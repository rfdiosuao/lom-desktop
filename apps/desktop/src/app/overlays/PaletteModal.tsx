import { Fragment } from 'react';
import { setTheme, toggleLeft, toggleRight } from '../shell/layout';
import { go, newTask, openConv, enterPhone, setMode } from '../navigation';
import { newTeam } from '@/features/teams/actions/teams';
import { pair } from '@/features/phones/actions/phone';
import { shortcuts } from '@/features/settings/actions/settings';
import { Avatar } from '@/shared/ui/Agent';
import { Kbd } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { Empty, Input } from '@/shared/ui/Layout';
import { agent, personaOf, phones } from '@/state/selectors';
import { S, update } from '@/state/store';
import type { Agent } from '@/state/types';
import { cx } from '@/shared/lib/util';

/* ===== 命令面板 ⌘K：搜索任务、手机、团队，或执行操作 ===== */

export interface PaletteItem { group: string; label: string; desc?: string; ic?: string; avatar?: Agent; run: () => void; }

export function paletteItems(): PaletteItem[] {
  const q = (S.q.palette || '').trim().toLowerCase();
  const ops: [string, string, () => void][] = [
    ['新的任务', 'plus', newTask], ['定时任务', 'clock', () => go('schedule')], ['skillhub', 'grid', () => go('skillhub')], ['OPC 团队', 'people', () => go('teams')],
    ['新建团队', 'userPlus', newTeam], ['添加手机', 'phone', pair], ['设置', 'settings', () => go('settings')],
    [S.mode === 'desktop' ? '切换到手机模式' : '切换到电脑模式', 'sync', () => setMode(S.mode === 'desktop' ? 'phone' : 'desktop')],
    ['切换深色 / 浅色', 'moon', () => setTheme(S.theme === 'dark' ? 'light' : 'dark')], ['收起 / 展开侧栏', 'sidebar', toggleLeft], ['收起 / 展开工作区', 'panelRight', toggleRight], ['快捷键', 'keyboard', shortcuts],
  ];
  const items: PaletteItem[] = [
    ...ops.map(([label, ic, run]) => ({ group: '操作', label, ic, run })),
    ...phones().map(p => ({ group: '手机', label: p.name, desc: personaOf(p), avatar: p, run: () => enterPhone(p.id) })),
    ...S.teams.map(t => ({ group: '团队', label: t.name, ic: 'people', run: () => go('team', t.id) })),
    ...S.convs.map(c => ({ group: c.owner === 'pc' ? '电脑任务' : `${agent(c.owner)?.name ?? ''} 的会话`, label: c.title, ic: 'message', run: () => openConv(c.id) })),
  ];
  return q ? items.filter(i => `${i.label}${i.desc || ''}${i.group}`.toLowerCase().includes(q)) : items;
}

export function runPaletteItem(i: number) {
  const it = paletteItems()[i];
  if (!it) return;
  update(s => { s.modals = []; });
  it.run();
}

export function PaletteModal() {
  const items = paletteItems().slice(0, 40);
  const idx = Math.min(S.paletteIdx || 0, Math.max(items.length - 1, 0));
  let last = '';
  return (
    <section className="modal palette" role="dialog" aria-modal="true" aria-label="搜索">
      <div className="modal__head">
        <div className="search grow"><Icon name="search" /><Input bind="q.palette" placeholder="搜索任务、手机、团队，或输入命令…" autoFocus onChange={v => update(s => { s.q.palette = v; s.paletteIdx = 0; })} /></div>
        <Kbd k="Esc" />
      </div>
      <div className="palette__list" role="listbox">
        {items.length ? items.map((it, i) => {
          const head = it.group !== last ? <div className="palette__group">{it.group}</div> : null;
          last = it.group;
          return (
            <Fragment key={`${it.group}-${it.label}-${i}`}>
              {head}
              <button type="button" role="option" aria-selected={i === idx} className={cx('menu__item', i === idx && 'is-focus')} onClick={() => runPaletteItem(i)}>
                {it.avatar ? <Avatar agent={it.avatar} size="sm" /> : <Icon name={it.ic || 'info'} />}
                <span className="menu__item-text"><span>{it.label}</span>{it.desc && <span className="menu__item-desc">{it.desc}</span>}</span>
                {i === idx && <Kbd k="↵" />}
              </button>
            </Fragment>
          );
        }) : <Empty ic="search" title="没有结果" />}
      </div>
    </section>
  );
}
