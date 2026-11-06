import { AssistantAvatar } from '@/features/personal/ui/AssistantAvatar';
import { MemberAvatar } from '../ui/MemberAvatar';
import type { ChatParticipant } from './participants';

/** 群聊成员头像：成员沿用团队头像，个人助理用它自己配置的形象或自定义头像；已删除的助理用默认形象 */
export function ParticipantAvatar({ p }: { p: ChatParticipant }) {
  if (p.assistant || !p.member) return <span className="avatar avatar--sm" aria-hidden="true"><AssistantAvatar assistant={p.assistant ?? {}} className="avatar__image" /></span>;
  return <MemberAvatar id={p.member.agent} name={p.name} size="sm" crown={p.leader} />;
}
