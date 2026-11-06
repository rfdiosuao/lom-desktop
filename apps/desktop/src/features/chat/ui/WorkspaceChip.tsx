import { browseFolder } from '../actions/composer';
import { workspaceState } from '@/features/workspace/runtime/required';
import { Btn, Dropdown } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { cx, prettyPath } from '@/shared/lib/util';
import { useStore } from '@/state/store';

/* ===== WS-REQUIRED-01：输入框上方的「工作区」条
 * 没选：醒目的「选择工作区」按钮，直接打开系统文件夹选择框。
 * 已选：显示路径，点开可更换（最近用过的在列表里）。
 * 旧会话没有记录工作区：照常能用，但提示补选。 */
export function WorkspaceChip({ ckey, prominent = false }: { ckey: string; prominent?: boolean }) {
  const s = useStore();
  const st = workspaceState(ckey);
  if (!st) return null;
  const set = st.kind === 'set';
  return (
    <div className={cx('ws-bar', !set && 'is-missing', prominent && 'ws-bar--prominent')} role="group" aria-label="工作区选择">
      <Icon name="folder" />
      <span className="ws-bar__label">工作区</span>
      {set
        ? <Dropdown label={prettyPath(st.path, s.homeDir)} ic="folder" menu="folder" variant="secondary" size="sm" className="ws-chip btn--path"
            title={`工作区：${st.path}（点击更换）`} ctx={{ ckey, key: `fold${ckey}` }} />
        : <Btn label={st.kind === 'legacy' ? '这个任务没有记录工作区，点此补选' : '选择工作区'} ic="folder" variant="primary" size="sm" className="ws-chip"
            onClick={() => void browseFolder(ckey)} />}
      {!set && <span className="ws-bar__hint">{st.kind === 'legacy' ? '补选后 AI 产出的文件才能在侧栏找到' : 'AI 需要先有一个文件夹，才能在里面创建和打开文件'}</span>}
    </div>
  );
}
