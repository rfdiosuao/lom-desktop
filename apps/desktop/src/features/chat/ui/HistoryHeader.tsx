import { openMenu, openModal } from '@/shared/overlays/controller';
import { newTask } from '@/app/navigation';
import { IconBtn } from '@/shared/ui/Button';
import { HistoryIcon } from '@/shared/ui/HistoryIcon';
import { t } from '@/shared/i18n/index';
import { historyAgentId, historyAgents } from '@/state/history';
import { useStore } from '@/state/store';

export function HistoryHeader() {
  const s = useStore(), id = historyAgentId(), agents = historyAgents();
  const current = agents.find(a => a.id === id)!;
  const backgroundRunning = agents.some(a => a.id !== id && a.running);
  return (
    <div className="sidebar__label history-heading">
      <button type="button" className="history-picker" title={`${current.name} · 切换历史会话分类${backgroundRunning ? '（其他 Agent 正在运行）' : ''}`} aria-label={`历史会话分类：${current.name}`} aria-haspopup="menu" aria-expanded={s.menu?.id === 'historyAgents'} onClick={e => openMenu('historyAgents', e.currentTarget)}>
        <HistoryIcon src={current.icon} name={backgroundRunning ? '其他 Agent' : current.name} lom={!id} running={backgroundRunning} />
      </button>
      <span className="history-heading__label">{t('最近任务')}</span>
      <span className="grow" />
      <IconBtn ic="archive" label="归档的任务" onClick={() => openModal('archived')} size="sm" />
      <IconBtn ic="newChat" label="新的任务" onClick={newTask} size="sm" />
    </div>
  );
}
