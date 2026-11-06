import { useEffect, useState } from 'react';
import { wsTab } from '@/app/shell/layout';
import { Btn, IconBtn } from '@/shared/ui/Button';
import { Badge, Seg, Spinner } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { useStore } from '@/state/store';
import type { AppState } from '@/state/state';
import type { FileChange, SnapshotChange, SnapshotView, TurnBase } from '@/state/types';
import { activeFolder, openFile } from '../runtime/workspace';
import { refreshSnapshot, snapshotGuard } from '../runtime/snapshot';
import { turnChangesFromBase } from '../runtime/turnBase';

/* WS-SNAPSHOT-01/02：核心文件快照给出的真实变更。「本轮」= 发送消息时记下的状态与现在相减；「全部未提交」= 相对 Git 提交或影子快照基线 */

const OP = { create: ['新增', 'ok'], modify: ['修改', 'info'], delete: ['删除', 'danger'] } as const;
const clock = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

function Row({ c }: { c: SnapshotChange }) {
  const [label, tone] = OP[c.operation];
  const body = <><Icon name="file" /><span className="grow ellipsis">{c.relative}</span>{c.staged && <Badge text="已暂存" />}<Badge text={label} tone={tone} /></>;
  if (c.operation === 'delete') return <div className="ftree__row diff-row" title="文件已被删除">{body}</div>;
  return <button type="button" className="ftree__row diff-row" onClick={() => { wsTab('files'); void openFile(c.path); }}>{body}</button>;
}

const baselineText = (snap: SnapshotView) => snap.mode === 'git-repo'
  ? `相对 Git 仓库当前提交${snap.branch ? `（分支 ${snap.branch}）` : ''}`
  : `相对 ${snap.since ? clock(snap.since) : '首次读取时'} 建立的文件快照，此前的改动不在其中`;

/** 这一轮能不能用：记录属于最后一条用户消息、同一个文件夹，且读取成功 */
function turnBaseOf(s: AppState, root: string) {
  const c = s.convs.find(x => x.id === s.activeConv), last = [...(c?.messages ?? [])].reverse().find(m => m.type === 'user');
  const base: TurnBase | undefined = c ? s.turnBase[c.id] : undefined;
  const mine = !!base && !!last && base.msgId === last.id && base.workspace === root;
  return { last, base: mine ? base : undefined, usable: mine && base!.status === 'ready' };
}

const turnNote = (base?: TurnBase) => !base ? '没有记录到这一轮开始时的文件状态（可能是打开的旧会话），下面是相对基线的全部变更。'
  : base.status === 'skipped' ? '工作文件夹范围很大，发送消息时没有记录文件状态，下面是相对基线的全部变更。'
  : base.status === 'failed' ? `发送消息时记录文件状态失败${base.code ? `（${base.code}）` : ''}：${base.error}。下面是相对基线的全部变更。` : '';

function Body({ root, snap, written }: { root: string; snap: SnapshotView; written: FileChange[] }) {
  const s = useStore(), { base, usable } = turnBaseOf(s, root);
  const [view, setView] = useState<'turn' | 'all'>('turn');
  const turn = usable && view === 'turn';
  const list = turn ? turnChangesFromBase(snap.changes, base!, written) : snap.changes;
  return <>
    {usable && <Seg options={[{ value: 'turn', label: '本轮' }, { value: 'all', label: '全部未提交' }]} value={view} onChange={setView} size="sm" label="变更范围" />}
    {!usable && <p className="msg__sys" style={{ marginTop: 8 }}>{turnNote(base)}</p>}
    <div className="msg__sys" style={{ margin: '8px 0' }}>
      {turn ? '本轮：和发送这条消息时记下的文件状态相比' : baselineText(snap)}{list.length ? `：${list.length} 个文件有变化` : '：没有变更'}
    </div>
    {turn && <p className="msg__sys" style={{ marginBottom: 8 }}>本轮开始前已改过的文件，只有出现在工具调用里才会列出；这期间你自己改的文件也会列出。</p>}
    {list.map(c => <Row key={c.path} c={c} />)}
  </>;
}

export function SnapshotChanges({ written }: { written: FileChange[] }) {
  const s = useStore(), root = activeFolder(), snap = s.snapshot;
  const { last } = turnBaseOf(s, root);
  useEffect(() => { void refreshSnapshot(root); }, [root, `${last?.id ?? ''}:${last?.turnOutcome ?? ''}`]);
  const mine = snap.workspace === root;
  let body;
  if (!root) body = <p className="msg__sys">还没有选择工作文件夹。</p>;
  else if (mine && snap.status === 'guarded') body = <>
    <p className="msg__sys">{snapshotGuard(root)}，所以没有自动建立。确认后会把这个文件夹现在的内容记为基线。</p>
    <Btn label="建立快照并读取" variant="secondary" size="sm" onClick={() => void refreshSnapshot(root, { force: true })} />
  </>;
  else if (!mine || snap.status === 'idle' || (snap.status === 'loading' && !snap.changes.length)) body = <p className="msg__sys"><Spinner />正在读取文件状态…</p>;
  else if (snap.status === 'error') body = <>
    <p className="msg__sys" role="alert">读取文件状态失败{snap.code ? `（${snap.code}）` : ''}：{snap.error}。下面只有根据工具调用推断的列表。</p>
    <Btn label="重试" ic="refresh" variant="secondary" size="sm" onClick={() => void refreshSnapshot(root, { force: true })} />
  </>;
  else body = <Body root={root} snap={snap} written={written} />;
  return <section aria-label="真实文件状态">
    <div className="row" style={{ marginBottom: 6 }}><b className="grow">真实文件状态</b>
      <IconBtn ic="refresh" label="刷新文件状态" size="sm" disabled={!root || snap.status === 'loading'} onClick={() => void refreshSnapshot(root, { force: snap.status !== 'guarded' })} /></div>
    {body}
  </section>;
}
