import { update } from '@/state/store';
import { api } from '@/core/client';
export interface CommandSkill { name: string; description: string; source: 'builtin' | 'custom' | 'cron' | 'extension'; }
let pending: Promise<void> | undefined;
export function loadCommandSkills() {
  if (pending) return pending;
  update(s => { s.commandSkills.loading = true; s.commandSkills.error = ''; });
  pending = (async () => {
    try {
      const rows = await api<CommandSkill[]>('GET', '/api/skills');
      update(s => { s.commandSkills.items = rows.filter(x => x.name).sort((a, b) => a.name.localeCompare(b.name)); });
    } catch (e) { update(s => { s.commandSkills.items = []; s.commandSkills.error = e instanceof Error ? e.message : String(e); }); }
    finally { pending = undefined; update(s => { s.commandSkills.loading = false; }); }
  })();
  return pending;
}
