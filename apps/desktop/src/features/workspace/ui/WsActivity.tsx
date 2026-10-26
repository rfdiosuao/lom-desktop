import { Icon } from '@/shared/ui/Icon';
import { Empty } from '@/shared/ui/Layout';
import { conv } from '@/state/selectors';
import { useStore } from '@/state/store';
import type { FileChange, PlanItem } from '@/state/types';
import { wsTab } from '@/app/shell/layout';
import { openFile } from '../runtime/workspace';

/* 当前任务的计划与文件变更：直接取自会话消息，不另存一份 */

export function planOf(messages: { type: string; items?: PlanItem[] }[] = []): PlanItem[] {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].type === 'plan' && messages[i].items?.length) return messages[i].items!;
  return [];
}

export function changesOf(messages: { type: string; changes?: FileChange[] }[] = []): FileChange[] {
  const byPath = new Map<string, FileChange>();
  for (const m of messages) if (m.type === 'files') for (const c of m.changes ?? []) {
    const old = byPath.get(c.path);
    byPath.set(c.path, old ? { path: c.path, add: old.add + c.add, del: old.del + c.del } : { ...c });
  }
  return [...byPath.values()];
}

const current = (s: ReturnType<typeof useStore>) => (s.route.name === 'chat' ? conv(s.activeConv) : undefined);

export function WsPlan() {
  const s = useStore();
  const items = planOf(current(s)?.messages);
  if (!items.length) return <Empty ic="check" title="还没有计划" desc="总指挥拆分任务时，步骤和进度会显示在这里。" />;
  const done = items.filter(i => i.done).length;
  return <>
    <div className="msg__sys" style={{ marginBottom: 8 }}>已完成 {done} / {items.length}</div>
    <ul className="ws-plan">
      {items.map((i, n) => <li key={n} className={i.done ? 'is-done' : ''}><Icon name={i.done ? 'check' : 'clock'} /><span>{i.text}</span></li>)}
    </ul>
  </>;
}

export function WsChanges() {
  const s = useStore();
  const list = changesOf(current(s)?.messages);
  if (!list.length) return <Empty ic="fileCode" title="还没有文件变更" desc="总指挥写入或修改文件后，会在这里列出。" />;
  return <>
    <div className="msg__sys" style={{ marginBottom: 8 }}>共修改 {list.length} 个文件</div>
    {list.map(c => <button key={c.path} type="button" className="ftree__row diff-row" onClick={() => { wsTab('files'); void openFile(c.path); }}>
      <Icon name="file" /><span className="grow ellipsis">{c.path}</span><span className="add">+{c.add}</span><span className="del">−{c.del}</span>
    </button>)}
  </>;
}
