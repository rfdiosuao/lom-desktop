import { api } from '@/core/client';
import type { CommandSkill } from '@/features/chat/runtime/commandSkills';

/** Personal skills must be selected explicitly when the core freezes a new session. */
export async function conversationSkills(): Promise<{ enabled_skills: string[] }> {
  const rows = await api<CommandSkill[]>('GET', '/api/skills');
  return { enabled_skills: [...new Set(rows.filter(s => s.source === 'custom' && s.name).map(s => s.name))] };
}
