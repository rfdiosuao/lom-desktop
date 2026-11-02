import { Icon } from '@/shared/ui/Icon';
import { logoUrl } from '@/features/settings/runtime/agents';
import { laneColor } from '../activity/activityTypes';
import { memberAgentRow } from '../runtime/team';
import { cx } from '@/shared/lib/util';

/* D33 成员空状态：会话窗格和看板空列共用这一份。
 * 48px 真实 Agent logo（来自 /api/agents/management 的 icon，经 logoUrl 拼出地址），
 * 名字用成员 id 的稳定身份色；Leader 额外给三条可以直接填进输入框的建议。 */

export interface EmptyStateMember {
  name: string;
  /** 桌面成员 id；身份色只由它决定，和 slot 无关。 */
  memberId: string;
  /** 桌面 agent 标识（'pc' / 'p1' / 'ag:…'），用来找头像。 */
  agentId: string;
  leader: boolean;
}

const SUGGESTIONS = [
  { key: 'debate', icon: 'people', text: '组织一场辩论赛，让成员分别站在正方和反方' },
  { key: 'add_member', icon: 'userPlus', text: '帮我加一个擅长 ___ 的成员' },
  { key: 'expert_review', icon: 'brain', text: '让多位专家会诊同一个问题' },
];

type Props = {
  member: EmptyStateMember;
  /** 看板列更窄：字号和间距小一点。 */
  compact?: boolean;
  /** 传入后建议可点，把文案交给这个成员的输入框。 */
  onSuggest?: (text: string) => void;
};

export function TeamEmptyState({ member, compact, onSuggest }: Props) {
  const row = memberAgentRow(member.agentId);
  const lom = member.agentId === 'pc';
  const logo = lom ? '/logo.png' : row ? logoUrl(row.icon) : '';
  const color = laneColor(member.memberId);

  return (
    <div className={cx('team-empty', compact && 'team-empty--compact')} data-testid="team-empty-state">
      {logo
        ? <img className={cx('team-empty__logo', lom && 'team-empty__logo--lom')} src={logo} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        : <span className="team-empty__logo team-empty__logo--letter" style={{ color }} aria-hidden="true">{(member.name || '?').slice(0, 1)}</span>}
      <div className="team-empty__name" style={lom ? undefined : { color }} title={member.name}>{member.name}</div>
      <p className="team-empty__greeting">
        {member.leader ? '我负责理解目标并协调团队，描述你想做的事。' : '我听 Leader 和你的指挥。'}
      </p>
      {member.leader && (
        <div className="team-empty__suggestions">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              className="team-empty__suggestion"
              data-testid={`team-empty-suggestion-${s.key}`}
              title={onSuggest ? `填入输入框：${s.text}` : s.text}
              disabled={!onSuggest}
              onClick={() => onSuggest?.(s.text)}
            >
              <Icon name={s.icon} />
              <span>{s.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
