import { Icon } from '@/shared/ui/Icon';
import { Empty } from '@/shared/ui/Layout';
import { SnapshotChanges } from './WsSnapshot';
import { conv } from '@/state/selectors';
import { useStore } from '@/state/store';
import type { FileChange, PlanItem } from '@/state/types';
import { wsTab } from '@/app/shell/layout';
import { absoluteIn } from '@/shared/lib/util';
import { activeFolder, openFile } from '../runtime/workspace';

/* 当前任务的计划与本轮文件变更：直接取自会话消息，不另存一份。变更来自写文件类工具的参数，没有接核心快照（#78 / CW02） */

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

/** 本轮 = 最后一条用户消息之后；没有用户消息（旧记录）时按整段计 */
export function turnChangesOf(messages: { type: string; changes?: FileChange[] }[] = []): FileChange[] {
  let from = 0;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].type === 'user') { from = i + 1; break; }
  return changesOf(messages.slice(from));
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
  const task = current(s), list = turnChangesOf(task?.messages);
  // 列表里显示相对路径，点开时一律用绝对路径（树里才能高亮，核心和系统打开也才找得到）
  const open = (path: string) => { wsTab('files'); void openFile(absoluteIn(path, task?.workspace || activeFolder())); };
  return <>
    <SnapshotChanges written={list} />
    <section aria-label="本轮工具调用（推断）" style={{ marginTop: 16 }}>
      <b>本轮 AI 写入的文件</b>
      <div className="msg__sys" style={{ margin: '4px 0 8px' }}>
        {list.length ? `本轮修改 ${list.length} 个文件` : '本轮还没有文件变更'} · 根据工具调用推断，不是磁盘或 Git 的真实状态；用命令行改的文件不会列出
      </div>
      {list.map(c => <button key={c.path} type="button" className="ftree__row diff-row" onClick={() => open(c.path)}>
        <Icon name="file" /><span className="grow ellipsis">{c.path}</span><span className="add">+{c.add}</span><span className="del">−{c.del}</span>
      </button>)}
    </section>
  </>;
}
