import { wsTab } from '@/app/shell/layout';
import { t } from '@/shared/i18n/index';
import { Icon } from '@/shared/ui/Icon';
import { conv } from '@/state/selectors';
import { S, useStore } from '@/state/store';

/* ===== WIN-TITLEBAR-01：工作区空白时的入口卡片，只列已有的视图 ===== */

const STARTS = [
  { view: 'files', ic: 'folder', title: '打开工作区文件', desc: '浏览当前任务的文件', idle: '浏览工作文件夹' },
  { view: 'plan', ic: 'kanban', title: '查看计划', desc: '任务的执行步骤', idle: '当前没有任务' },
  { view: 'changes', ic: 'fileCode', title: '查看变更', desc: '本轮文件改了什么', idle: '当前没有任务' },
  { view: 'phone', ic: 'phone', title: '打开手机', desc: '同步查看手机屏幕', idle: '同步查看手机屏幕' },
] satisfies { view: typeof S.wsTab; ic: string; title: string; desc: string; idle: string }[];

/** 计划、变更都取自当前打开的任务；没有任务时如实写「当前没有任务」 */
export function WsStart() {
  const s = useStore();
  const hasTask = s.route.name === 'chat' && !!conv(s.activeConv);
  return (
    <div className="ws-start" role="group" aria-label={t('工作区入口')}>
      {STARTS.map(card => (
        <button key={card.view} type="button" className="ws-start__card" onClick={() => wsTab(card.view)}>
          <span className="ws-start__icon"><Icon name={card.ic} /></span>
          <span className="ws-start__text"><b>{t(card.title)}</b><small>{t(hasTask ? card.desc : card.idle)}</small></span>
        </button>
      ))}
    </div>
  );
}
