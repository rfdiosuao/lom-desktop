import { useId } from 'react';
import type { Msg } from '@/state/types';
import { update, useStore } from '@/state/store';
import { Icon } from '@/shared/ui/Icon';
import { Spinner } from '@/shared/ui/Controls';
import { Message } from './Message';
import { ToolCalls } from './ToolCalls';
import { Elapsed } from './Elapsed';
import { cx } from '@/shared/lib/util';

/** 组标题：先看是否在思考，再看工具执行到哪一步 */
function headline(tools: number, completed: number, { thinking, running, pending }: { thinking: boolean; running: boolean; pending: boolean }) {
  if (!tools) return thinking ? '正在思考' : '执行过程';
  if (thinking) return `正在思考 · ${tools} 次工具`;
  if (running) return `正在执行 · ${completed}/${tools}`;
  if (pending) return `等待中 · ${completed}/${tools}`;
  return `执行工具 ${tools} 次`;
}

/** 思考、工具和文件改动共用一个过程；正文、提问和审批仍留在原来的消息顺序里。 */
export function ActivityGroup({ items, ctxId, active, live = false }: { items: Msg[]; ctxId: string; active: boolean; live?: boolean }) {
  const s = useStore(), panel = useId();
  const tools = items.filter(m => m.type === 'tool'), thoughts = items.filter(m => m.type === 'thinking');
  const files = items.filter(m => m.type === 'files'), work = items.filter(m => m.type !== 'files');
  const changed = new Set(files.flatMap(m => m.changes?.map(c => c.path) ?? [])).size;
  // 流式工具序列后来插入思考时，继续使用 ToolCalls 的折叠选择。
  const id = `tools:${tools[0]?.id ?? items[0].id}`;
  const running = tools.some(m => m.status === 'running');
  // 进行中（本组在跑，或所在的一轮还没结束）默认展开，整轮结束后默认收起；用户手动选择后一直保留。
  // 与工具组 ToolCalls 的默认（running || live）一致，避免结束时来回翻转
  const open = s.eventOpen[id] ?? s.eventOpen[`tools:${items[0].id}`] ?? (live || active || running);
  const failed = tools.filter(m => m.status === 'error').length;
  const thoughtActive = active && items.at(-1)?.type === 'thinking';
  const pending = tools.some(m => ['pending', 'queued', 'unconfirmed'].includes(m.status || ''));
  const done = !running && !thoughtActive && tools.every(m => m.status === 'done');
  const completed = tools.filter(m => m.status === 'done').length;
  const text = thoughts.map(m => m.text).filter(Boolean).join('\n\n');
  return <div className="activity" role="group" aria-label="执行过程">
    <button type="button" className="activity__head" aria-expanded={open} aria-controls={panel}
      onClick={() => update(st => { st.eventOpen[id] = !open; })}>
      <Icon name="chevron" className={cx('tools__chev', open && 'is-open')} />
      {running || thoughtActive ? <Spinner size={12} /> : <Icon name={done ? 'check' : failed ? 'close' : 'clock'} />}
      <span>{headline(tools.length, completed, { thinking: thoughtActive, running, pending })}</span>
      {!!changed && <span className="activity__changes">修改 {changed} 个文件</span>}
      {!!failed && <span className="tool__fail">{failed} 个失败</span>}
      {!!work.length && <Elapsed items={work} active={running || thoughtActive} />}
    </button>
    <div id={panel} className={cx('activity__body', !open && 'activity__body--collapsed')}>
      {!!tools.length && <ToolCalls items={tools} ctxId={ctxId} compact expanded={open} />}
      {open && files.map(m => <div className="activity__files" key={m.id}><Message m={m} ctxId={ctxId} /></div>)}
      {open && thoughts[0] && <Message m={{ ...thoughts[0], text }} ctxId={ctxId} compactThinking thinkingActive={thoughtActive} />}
    </div>
  </div>;
}
