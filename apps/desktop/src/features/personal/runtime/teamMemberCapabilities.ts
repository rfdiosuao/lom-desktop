import { api } from '@/core/client';
import type { CoreConversation } from '@/core/types';
import { conversationOf, memberInfo } from '@/features/teams/runtime/team';
import type { Team } from '@/state/types';

type Connector = { id: string; name: string; enabled: boolean };

export async function teamMemberCapabilities(team: Team, current: () => boolean) {
  const members = team.members.slice(0, 12);
  const targets = members.map(member => ({ member, session: conversationOf(team, member) }));
  const settings = targets.some(({ session }) => session?.remote)
    ? await api<Connector[]>('GET', '/api/mcp/servers', undefined, { timeoutMs: 5000 }).catch(() => null)
    : null;
  return Promise.all(targets.map(async ({ member, session }) => {
    if (!current()) throw new Error('团队或权限已变化');
    const info = memberInfo(member.agent);
    const id = session?.id ?? (member.leader ? team.leaderConv : team.memberConvs?.[member.mid]) ?? null;
    const row = session?.remote && Array.isArray(settings)
      ? await api<CoreConversation>('GET', `/api/conversations/${encodeURIComponent(session.id)}`, undefined, { timeoutMs: 5000 }).catch(() => null)
      : null;
    const selected = row?.extra?.mcp_server_ids;
    if (!current()) throw new Error('团队或权限已变化');
    return { member_id: member.mid, name: info.name.slice(0, 160), role: member.role.slice(0, 80), specialty: info.note.slice(0, 240),
      kind: info.kind, observed_available: info.online, leader: !!member.leader, session_id: id,
      connectors: Array.isArray(selected) && Array.isArray(settings) ? settings.filter(s => !s.name.startsWith('lom-phone-')).slice(0, 50).map(s => ({
        name: s.name.slice(0, 120), state: selected.includes(s.id) ? 'selected' : 'not_selected',
      })) : null,
      connector_evidence: Array.isArray(selected) ? '会话配置快照，未测试实际调用；不含 Agent 自行加载的连接器。' : '未取得连接器快照，实际接入状态未知。',
    };
  }));
}
