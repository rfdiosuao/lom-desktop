import { avatarUrl, customAvatar } from '@/features/personal/runtime/avatars';
import { loadAssistants } from '@/features/personal/runtime/catalog';
import { logoUrl } from '@/features/settings/runtime/agents';
import { insertMention } from '@/features/chat/actions/composer';
import { memberAgentRow } from '@/features/teams/runtime/team';
import type { MenuItem } from '@/shared/ui/Overlay';
import { agent } from '@/state/selectors';
import { S, update } from '@/state/store';
import type { MenuCtx } from '@/state/types';
import { chatParticipants, EVERYONE, type ChatParticipant } from './participants';

/* ===== TEAM-CHAT-01 群聊菜单：@ 选择接收者、邀请个人助理 =====
 * 选中即把成员身份键记进接收者列表；正文里的「@名字」只是给人看的文字，不参与路由。 */

const teamOf = (ckey: string) => S.teams.find(t => t.id === ckey.slice('teamchat:'.length));

function look(p: ChatParticipant): Pick<Extract<MenuItem, { onSelect: () => void }>, 'img' | 'avatar'> {
  if (p.assistant) return { img: customAvatar(p.assistant) ?? avatarUrl(p.assistant.avatar) };
  const row = memberAgentRow(p.member!.agent), logo = row ? logoUrl(row.icon) : undefined;
  return logo ? { img: logo } : { avatar: agent(p.member!.agent) ?? { id: p.key, kind: 'user', name: p.name, persona: p.role, status: 'online' } };
}

export function pickTarget(teamId: string, key: string) {
  update(s => { const list = s.teamChatTargets[teamId] ?? []; if (!list.includes(key)) s.teamChatTargets[teamId] = [...list, key]; });
}

export function teamChatMentionMenu(ckey: string): MenuItem[] {
  const t = teamOf(ckey);
  if (!t) return [];
  return [{ header: true, label: '发给群聊成员' },
    { label: '所有人', desc: '队长和全部成员各收一次，不含个人助理', ic: 'people', onSelect: () => { pickTarget(t.id, EVERYONE); insertMention(ckey, '@所有人 '); } },
    ...chatParticipants(t).map(p => ({
    label: p.name, desc: p.blocked ?? p.role, disabled: !!p.blocked, ...look(p),
    onSelect: () => { pickTarget(t.id, p.key); insertMention(ckey, `@${p.name} `); },
  }))];
}

/** 每个团队 0～1 位个人助理加入群聊（§9-④）；只改群聊名单，不进核心团队、不动执行成员 */
export function teamChatAssistantMenu(ctx: MenuCtx): MenuItem[] {
  const t = S.teams.find(x => x.id === ctx.id);
  if (!t) return [];
  let items: { id: string; name: string }[] = [];
  try { items = loadAssistants().items; }
  catch (e) { return [{ label: e instanceof Error ? e.message : '读取个人助理失败', disabled: true, onSelect: () => {} }]; }
  const set = (id?: string) => update(s => { if (id) t.chatAssistant = id; else delete t.chatAssistant; delete s.teamChatTargets[t.id]; });
  return [{ header: true, label: '加入群聊的个人助理' },
    ...items.map(a => ({ label: a.name, select: 'single' as const, checked: t.chatAssistant === a.id, onSelect: () => set(a.id) })),
    ...(items.length ? [] : [{ label: '还没有个人助理', disabled: true, onSelect: () => {} }]),
    '-', { label: '不邀请个人助理', select: 'single' as const, checked: !t.chatAssistant, onSelect: () => set() }];
}
