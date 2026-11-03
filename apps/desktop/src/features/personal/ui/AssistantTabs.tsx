import { useEffect, useRef, useState } from 'react';
import { Btn, IconBtn } from '@/shared/ui/Button';
import type { PersonalAssistant } from '../runtime/catalog';
import { AssistantAvatar } from './AssistantAvatar';

type Props = {
  items: PersonalAssistant[]; selected: string; onSelect: (item: PersonalAssistant) => void;
  /** PA-TAB-01：标签上的 × 删除这位助理（先确认） */
  onDelete: (item: PersonalAssistant) => void;
  /** 正在执行任务的助理不能删除 */
  running: (item: PersonalAssistant) => boolean;
  busy?: boolean;
};

/** 标题栏助理标签条（UI-AUDIT-03）：隐藏滚动条，普通滚轮也横向滚动；选中的标签滚到可见处，被裁掉的一侧渐隐，提示还有更多标签 */
export function AssistantTabs({ items, selected, onSelect, onDelete, running, busy }: Props) {
  const tabs = useRef<HTMLDivElement>(null), [fade, setFade] = useState('');
  const edges = () => { const el = tabs.current; if (!el) return; const start = el.scrollLeft > 1, end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1; setFade(start && end ? 'both' : start ? 'start' : end ? 'end' : ''); };
  const shown = items.map(x => x.id).join('\n');
  useEffect(() => { tabs.current?.querySelector('.is-active')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); edges(); }, [selected, shown]);
  useEffect(() => { const el = tabs.current; if (!el || typeof ResizeObserver === 'undefined') return; const ro = new ResizeObserver(edges); ro.observe(el); return () => ro.disconnect(); }, []);
  return <div className="pa-assistants" aria-label="个人助理列表" ref={tabs} data-fade={fade || undefined} onScroll={edges} onWheel={e => { if (!e.deltaX && e.deltaY) e.currentTarget.scrollLeft += e.deltaY; }}>
    {items.map(item => <div className="pa-assistant-tab" key={item.id}>
      <Btn label={<><AssistantAvatar assistant={item} />{item.name}</>} title={item.name} variant="pill" active={item.id === selected} onClick={() => onSelect(item)} />
      <IconBtn ic="close" size="sm" label={`删除助理：${item.name}`} disabled={busy || running(item)} title={running(item) ? `${item.name}正在执行任务，结束后才能删除` : undefined} onClick={() => onDelete(item)} />
    </div>)}
  </div>;
}
