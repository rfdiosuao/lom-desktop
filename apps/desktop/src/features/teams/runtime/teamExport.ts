import { loadFullHistory, messageLines } from '@/features/chat/runtime/exportMarkdown';
import type { Conv, Team } from '@/state/types';
import { conversationOf, memberInfo } from './team';

/* TEAM-MENU-01 团队导出：按成员顺序每人一节，回复方用成员名；
 * 几位成员共用的会话只导出一次；先读完整记录，读取失败的成员如实标出并返回给调用方。 */

export interface TeamExport { markdown: string; failed: string[] }

async function loadAll(convs: Conv[]): Promise<Map<string, boolean>> {
  const results = await Promise.all(convs.map(c => loadFullHistory(c).then(() => true, (e: unknown) => {
    console.warn('team.export_member_failed', c.id, e);
    return false;
  })));
  return new Map(convs.map((c, i) => [c.id, results[i]]));
}

export async function exportTeamMarkdown(t: Team): Promise<TeamExport> {
  const convs = t.members.map(m => (t.real ? conversationOf(t, m) : undefined));
  const loaded = await loadAll([...new Set(convs.filter((c): c is Conv => !!c))]);
  const lines = [`# ${t.name}`, ''], failed: string[] = [], firstOwner = new Map<string, string>();
  t.members.forEach((m, i) => {
    const info = memberInfo(m.agent), title = `${info.name} · ${m.role}`, c = convs[i];
    lines.push(`## ${title}`, '');
    if (c && firstOwner.has(c.id)) { lines.push(`（与「${firstOwner.get(c.id)}」共用同一会话，记录见上文）`, ''); return; }
    if (c) firstOwner.set(c.id, title);
    if (c && !loaded.get(c.id)) { failed.push(title); lines.push('（这位成员的记录读取失败，没有导出）', ''); return; }
    const messages = c ? c.messages : t.real ? [] : t.panes[m.mid] ?? [];
    lines.push(...(messages.length ? messageLines(messages, info.name) : ['（还没有对话记录）', '']));
  });
  return { markdown: lines.join('\n'), failed };
}
