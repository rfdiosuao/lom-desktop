import { api } from './client';
import type { AgentRow, Conversation } from './types';

/** Local CLI discovery. Bundled commercial agents are deliberately excluded. */
export async function listAgents(): Promise<AgentRow[]> {
  const rows = await api<AgentRow[]>('GET', '/api/agents/management');
  const best = new Map<string, AgentRow>();
  const rank = (a: AgentRow) => (a.agent_type === 'acp' ? 2 : 0) + (a.backend ? 1 : 0);
  for (const row of rows.filter(r => r.agent_source !== 'internal')) {
    const key = row.name.trim().toLowerCase(), prev = best.get(key);
    if (!prev || rank(row) > rank(prev)) best.set(key, row);
  }
  return [...best.values()];
}
export const testAgent = (id: string) => api<AgentRow>('POST', `/api/agents/${encodeURIComponent(id)}/health-check`, {});
/** Creating a conversation does not send a prompt or inherit elevated permissions. */
export function createConversation(agent: AgentRow, name: string, workspace: string) {
  if (!agent.installed || !agent.enabled || ['missing', 'offline'].includes(agent.status) || agent.agent_source === 'internal')
    throw new Error('请选择可用的本机 CLI');
  return api<Conversation>('POST', '/api/conversations', {
    type: 'acp', name, extra: { agent_id: agent.id, agent_name: agent.name, backend: agent.backend, workspace, session_mode: 'default' },
  });
}
/** Only call after a user sends explicitly. A returned turn ID is acceptance, not completion. */
export const sendMessage = (id: string, content: string) => api<{ turn_id?: string }>('POST', `/api/conversations/${encodeURIComponent(id)}/messages`, { content, files: [] });
export const cancelTurn = (id: string, turnId: string) => api('POST', `/api/conversations/${encodeURIComponent(id)}/cancel`, { turn_id: turnId });
