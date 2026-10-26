import { coreTeamOf } from '@/state/selectors';
import type { Conv, DraftAttachment } from '@/state/types';
import { sendToTask } from './tasks';
import { conversationOf, sendToTeam } from '@/features/teams/runtime/team';

/** Message actions must use the same transport as the conversation's composer. */
export function resendToConversation(c: Conv, text: string, attachments: DraftAttachment[] = []): Promise<boolean> {
  const t = coreTeamOf(c.id);
  if (!t) return sendToTask(c, text, attachments);
  const member = t.members.find(m => conversationOf(t, m)?.id === c.id);
  if (!member) return Promise.reject(new Error('团队成员与会话不匹配，请重新打开团队'));
  return sendToTeam(t, member, text, attachments);
}
