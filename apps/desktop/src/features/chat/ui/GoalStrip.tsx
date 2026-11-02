import { useEffect, useState } from 'react';
import { editGoalCmd, goalKeyOf } from '../actions/commands';
import { confirm, toast } from '@/shared/overlays/controller';
import { IconBtn } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { clearGoal, fmtElapsed, goalElapsed, pauseGoal, resumeGoal } from '../runtime/commands';
import { convOfKey } from '@/features/teams/runtime/team';
import { useStore } from '@/state/store';
import { cx } from '@/shared/lib/util';

/* ===== 进行中的目标：贴在输入框上方，显示目标、已推进多久；删除、暂停 / 继续、修改 ===== */
export function GoalStrip({ ckey }: { ckey: string }) {
  const s = useStore();
  const goalKey = goalKeyOf(ckey);
  const g = goalKey ? s.goals[goalKey] : undefined;
  const [, tick] = useState(0);
  const active = !!g && !g.done && !g.paused && goalKey !== 'home';
  useEffect(() => { if (!active) return; const t = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(t); }, [active]);
  if (!goalKey || !g) return null;
  const c = convOfKey(ckey);
  const running = !!c && !!s.running[c.id];
  const label = g.done ? '目标已达成' : g.paused ? '已暂停的目标' : goalKey === 'home' ? '目标' : '进行中的目标';
  const resume = () => {
    resumeGoal(goalKey);
    // 现在没在跑就马上推进一轮
    if (c && !s.running[c.id]) void import('../runtime/tasks').then(t => t.continueGoal(c));
    toast('继续推进目标', 'flag');
  };
  return (
    <div className={cx('goal-strip', g.done && 'is-done', g.paused && 'is-paused')} role="status" aria-label={`${label}：${g.text}`}>
      <span className={cx('goal-strip__ic', running && !g.paused && 'is-spinning')}><Icon name={g.done ? 'check' : g.paused ? 'pause' : 'sync'} /></span>
      <b className="goal-strip__label">{label}</b>
      <span className="goal-strip__text" title={g.text}>{g.text}</span>
      {goalKey !== 'home' && <span className="goal-strip__time">· {fmtElapsed(goalElapsed(g))}{g.note ? ` · ${g.note}` : ''}</span>}
      <span className="grow" />
      <IconBtn ic="trash" label="删除目标" size="sm" onClick={() => confirm({ title: '删除这个目标？', desc: '只删除目标，已经做的事和对话都保留；之后不再自动推进。', okText: '删除', onOk: () => clearGoal(goalKey) })} />
      {!g.done && goalKey !== 'home' && (g.paused
        ? <IconBtn ic="play" label="继续推进" size="sm" onClick={resume} />
        : <IconBtn ic="pause" label="暂停：这一轮做完后不再自动推进" size="sm" onClick={() => pauseGoal(goalKey, '已手动暂停')} />)}
      <IconBtn ic="expand" label="修改目标" size="sm" onClick={() => editGoalCmd(goalKey)} />
    </div>
  );
}
