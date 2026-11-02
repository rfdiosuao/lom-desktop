import { agentRow, logoUrl } from '@/features/settings/runtime/agents';
import { convsOf } from '@/state/selectors';
import { S, update } from '@/state/store';

/** 独立桌面会话；团队、侧边对话仍由各自入口管理。 */
export const desktopHistory = () => convsOf('pc').filter(c => !c.teamId && !c.sideOf && !c.personal);


export function historySourceAgent(source: string) {
  return S.agentCatalog?.find(a => a.backend === source || (source === 'claude' && a.backend === 'claude-code'));
}
export const historySourceId = (source: string) => historySourceAgent(source)?.id || `history:${source}`;
export function historyAgentId() {
  return S.historyAgentPick.startsWith('archive:') ? historySourceId(S.historyAgentPick.slice(8)) : S.historyAgentPick;
}
/** D34：左侧要显示的导入历史——已续聊成任务的由任务代表；移出列表、或对应任务已归档 / 删除的不显示 */
export const shownImports = (id: string) =>
  S.historyImports.filter(e => historySourceId(e.source) === id && !S.historyHidden.includes(e.id) && !S.convs.some(c => c.historyArchiveId === e.id));
export const hideHistory = (...ids: (string | undefined)[]) => {
  const next = ids.filter((id): id is string => !!id && !S.historyHidden.includes(id));
  if (next.length) update(s => { s.historyHidden = [...s.historyHidden, ...next]; });
};
export const unhideHistory = (id?: string) => {
  if (id && S.historyHidden.includes(id)) update(s => { s.historyHidden = s.historyHidden.filter(x => x !== id); });
};
export function historyAgents() {
  const tasks = desktopHistory();
  const ids = new Set([...S.historyImports.map(e => historySourceId(e.source)), '', ...S.agentPins, ...tasks.map(c => c.agentId || ''), historyAgentId()]);
  return [...ids].map(id => {
    const row = agentRow(id), items = tasks.filter(c => (c.agentId || '') === id);
    const imported = shownImports(id);
    const source = imported[0]?.source;
    return {
      id, name: id ? row?.name || items.find(c => c.agentName)?.agentName || (source === 'codex' ? 'Codex CLI' : source === 'claude' ? 'Claude Code' : id) : 'Lom',
      icon: id ? logoUrl(row?.icon) : '/logo.png',
      count: items.length + imported.length, running: items.filter(c => S.running[c.id]).length,
    };
  });
}
