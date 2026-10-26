import { Seg, Toggle } from '@/shared/ui/Controls';
import { FALLBACK_LANE } from './activityTypes';
import type { ActivityDirection, ActivityKind } from './activityTypes';

/* D33 看板工具栏：排序、内容筛选、成员筛选、系统消息、已完成任务。
 * 成员筛选是多选；不选任何成员等于全部成员。 */

export interface ActivityControlsState {
  direction: ActivityDirection;
  kind: ActivityKind;
  /** 已选成员 slot；空数组 = 全部成员。 */
  members: string[];
  showSystem: boolean;
  showFinished: boolean;
}

export const defaultActivityControls: ActivityControlsState = {
  direction: 'desc', kind: 'all', members: [], showSystem: false, showFinished: false,
};

export interface ActivityLaneOption { slotId: string; name: string }

type Props = {
  value: ActivityControlsState;
  onChange: (next: ActivityControlsState) => void;
  members: ActivityLaneOption[];
};

export function ActivityControls({ value, onChange, members }: Props) {
  const patch = (partial: Partial<ActivityControlsState>) => onChange({ ...value, ...partial });
  const toggleMember = (slotId: string) => {
    const selected = value.members.includes(slotId)
      ? value.members.filter((id) => id !== slotId)
      : [...value.members, slotId];
    patch({ members: selected });
  };

  return (
    <div className="act-bar" data-testid="activity-control-bar">
      <Seg
        options={[{ value: 'desc', label: '最新在前' }, { value: 'asc', label: '最早在前' }]}
        value={value.direction}
        onChange={(direction) => patch({ direction })}
      />
      <Seg
        options={[{ value: 'all', label: '全部' }, { value: 'message', label: '消息' }, { value: 'task', label: '任务' }]}
        value={value.kind}
        onChange={(kind) => patch({ kind })}
      />

      <div className="act-bar__members" role="group" aria-label="成员筛选">
        <button type="button" className="act-bar__chip" aria-pressed={value.members.length === 0} onClick={() => patch({ members: [] })}>全部成员</button>
        {members.map((member) => (
          <button
            key={member.slotId}
            type="button"
            className="act-bar__chip"
            aria-pressed={value.members.includes(member.slotId)}
            title={member.name}
            onClick={() => toggleMember(member.slotId)}
          >
            {member.name}
          </button>
        ))}
        <button
          type="button"
          className="act-bar__chip"
          aria-pressed={value.members.includes(FALLBACK_LANE)}
          title="未分配 / 外部"
          onClick={() => toggleMember(FALLBACK_LANE)}
        >
          未分配 / 外部
        </button>
      </div>

      <span className="act-bar__switch">
        <Toggle size="sm" on={value.showSystem} label="显示系统消息" onChange={() => patch({ showSystem: !value.showSystem })} />
        <span>系统消息</span>
      </span>
      <span className="act-bar__switch">
        <Toggle size="sm" on={value.showFinished} label="显示已完成任务" onChange={() => patch({ showFinished: !value.showFinished })} />
        <span>已完成任务</span>
      </span>
    </div>
  );
}
