/** Desktop-local boundary only. No cloud, billing, phone or pairing contracts. */
export interface Endpoint { url: string; token: string; defaultFolder: string; homeDir: string; }
export interface CoreEvent { name: string; data: Record<string, unknown>; }
export interface AgentRow {
  id: string; name: string; backend?: string; agent_type: string; agent_source: string;
  installed: boolean; enabled: boolean; status: 'missing' | 'online' | 'offline' | 'unchecked';
}
export interface Conversation { id: string; name: string; type: string; }
