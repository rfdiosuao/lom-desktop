import { Icon } from '@/shared/ui/Icon';
import { useStore } from '@/state/store';
import type { TeamChatMeta } from '@/state/types';
import { assistantDirectory, assistantSender, chatParticipants } from './participants';

/** 用户消息气泡里的群聊来源：「来自群聊 · 你 → @A @B」或「来自个人助理：小鹿 → @A」。
 *  名字按身份键取当前配置（发送的助理不必是群聊成员，TEAM-CHAT-01E）；助理已被删除才用信封里记下的名字。 */
export function TeamChatSource({ meta }: { meta: TeamChatMeta }) {
  const s = useStore();
  const t = s.teams.find(x => x.id === meta.team);
  const people = t ? chatParticipants(t) : [];
  const sender = meta.from.kind === 'personal' ? assistantSender(meta.from.id, assistantDirectory(), meta.from.name) : undefined;
  const from = !sender ? '来自群聊 · 你'
    : sender.removed ? `来自个人助理：${sender.recordedName ? `${sender.recordedName}（已移除）` : '已移除的助理'}`
    : `来自个人助理：${sender.name}`;
  const to = meta.to.map(r => `@${people.find(p => p.key === r.key)?.name ?? r.name}`).join(' ');
  return <div className="msg__schedule-source" data-team-chat={meta.post}><Icon name="people" />{from} → {to}</div>;
}
