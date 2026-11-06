import type { CoreConversation } from '@/core/types';
import { teamMemberPhoneBridge } from '@/features/phones/runtime/phoneCommander';
import { S, update } from '@/state/store';
import type { Team } from '@/state/types';
import { phonesOf } from './team';
import { teamRequest, teamStep } from './teamGuard';

type Conversation = CoreConversation & { runtime?: { has_task?: boolean; is_processing?: boolean } };

export async function attachMemberPhoneBridges(team: Team, conversations: string[], current: () => boolean) {
  if (!conversations.length || S.cloud !== 'signed-in' || !S.account?.id || team.ownerAccountId !== S.account.id || !phonesOf(team).length) return;
  const registry = await teamRequest<{ id: string; name: string }[]>(current, 'GET', '/api/mcp/servers');
  for (const id of conversations) {
    const path = `/api/conversations/${id}`;
    const row = await teamRequest<Conversation>(current, 'GET', path);
    const previous = row.extra?.lom_phone_scope;
    const scope = previous?.startsWith('team-member-') ? previous : `team-member-${crypto.randomUUID()}`;
    const bridge = await teamStep(current, () => teamMemberPhoneBridge(scope, current));
    const selected = row.extra?.mcp_server_ids ?? [];
    if (previous !== scope || !selected.includes(bridge)) {
      if (row.runtime?.is_processing) throw new Error('成员正在运行，请结束后再同步手机工具');
      const replaced = new Set(registry.filter(server => server.name === `lom-phone-${scope}`).map(server => server.id));
      const updated = await teamRequest<CoreConversation>(current, 'PATCH', path, { extra: {
        lom_phone_scope: scope, selected_mcp_server_ids: [...selected.filter(server => !replaced.has(server)), bridge],
      } });
      if (updated.extra?.lom_phone_scope !== scope || !updated.extra?.mcp_server_ids?.includes(bridge))
        throw new Error('核心未确认成员手机工具配置');
      if (row.runtime?.has_task) await teamRequest(current, 'POST', `${path}/runtime/restart`, {});
    }
    const conv = S.convs.find(c => c.id === id);
    if (conv) update(() => { conv.phoneScope = scope; });
  }
}
