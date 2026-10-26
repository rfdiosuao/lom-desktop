import { openModal } from '@/shared/overlays/controller';
import { addAgents } from '@/features/settings/actions/agents';
import { openAgentHistory } from '@/features/chat/actions/history';
import { HistoryIcon } from '@/shared/ui/HistoryIcon';
import type { MenuItem } from '@/shared/ui/Overlay';
import { historyAgentId, historyAgents } from '@/state/history';

export function historyMenu(): MenuItem[] {
  const selected = historyAgentId();
  return [
    { header: true, label: '历史会话 · 按 Agent 分类' },
    ...historyAgents().map(a => ({
      label: a.name, hint: a.running ? `${a.running} 个运行中` : `${a.count} 个会话`,
      leading: <HistoryIcon src={a.icon} name={a.name} lom={!a.id} running={a.running > 0} />,
      select: 'single' as const, checked: a.id === selected, onSelect: () => openAgentHistory(a.id),
    })),
    '-',
    { label: '管理 Agent', ic: 'plus', onSelect: addAgents },
    { label: '导入会话历史', desc: '扫描、预览并归档 Codex / Claude Code 历史', ic: 'download', onSelect: () => openModal('historyImport') },
  ];
}
