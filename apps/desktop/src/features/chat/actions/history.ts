import { update } from '@/state/store';

/** 历史筛选独立于当前聊天；点具体记录才会导航。 */
export function openAgentHistory(id: string) {
  update(s => { s.historyAgentPick = id; s.menu = null; });
}
