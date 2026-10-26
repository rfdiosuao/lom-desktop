import { Typing } from '@/shared/ui/Controls';
import type { Conv } from '@/state/types';
import { Message } from './Message';

/** Keep the waiting state in the reply flow; streamed content owns its own indicator. */
export function ReplyPending({ c }: { c: Conv }) {
  const lastUser = c.messages.map(m => m.type).lastIndexOf('user');
  const turn = c.messages.slice(lastUser + 1);
  if (turn.some(m => m.streaming || m.status === 'running' || ((m.type === 'approval' || m.type === 'question') && (m.status === 'pending' || m.status === 'submitting')))) return null;
  const hasReply = turn.some(m => m.type === 'assistant');
  const hasIdentity = hasReply || (!c.agentId && c.owner === 'pc' && turn.some(m => m.type === 'tool' || m.type === 'thinking'));
  return <div className="reply-pending" role="status" aria-label="正在等待回复">
    {!hasIdentity && <Message m={{ id: 'pending-identity', type: 'assistant', at: c.messages[lastUser]?.at ?? c.updated }} ctxId={c.id} headerOnly />}
    <div className="msg msg--cont"><span className="msg__gutter" aria-hidden="true" /><div className="msg__body reply-pending__status"><Typing /><span>{hasReply ? '正在继续处理…' : '正在等待回复…'}</span></div></div>
  </div>;
}
