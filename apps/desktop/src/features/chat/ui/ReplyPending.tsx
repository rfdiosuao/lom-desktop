import { Typing } from '@/shared/ui/Controls';
import type { Conv, Msg } from '@/state/types';
import { Message } from './Message';

/** 这一轮里有自己运行指示的内容：流式正文、运行中的思考或工具、待确认 / 待回答的提问 */
const activeIn = (turn: Msg[]) => turn.some(m => m.streaming || m.status === 'running'
  || ((m.type === 'approval' || m.type === 'question') && (m.status === 'pending' || m.status === 'submitting')));

/** UI-AUDIT-05：整轮运行期间一直挂在回复末尾。别的内容有自己的运行指示时只留空的状态行，
 *  不卸载、不改高度，对话区不会随思考 / 工具 / 正文的切换上下跳动。 */
export function ReplyPending({ c }: { c: Conv }) {
  const lastUser = c.messages.map(m => m.type).lastIndexOf('user');
  const turn = c.messages.slice(lastUser + 1);
  const quiet = activeIn(turn);
  const hasReply = turn.some(m => m.type === 'assistant'), label = hasReply ? '正在继续处理…' : '正在等待回复…';
  // 与 MessageList 相同：桌面回复在第一次思考或工具时已显示身份，这里不再重复
  const desktopReply = c.owner === 'pc' && !c.phoneSession;
  const hasIdentity = hasReply || (desktopReply && turn.some(m => m.type === 'tool' || m.type === 'thinking'));
  return <div className="reply-pending">
    {!quiet && !hasIdentity && <Message m={{ id: 'pending-identity', type: 'assistant', at: c.messages[lastUser]?.at ?? c.updated }} ctxId={c.id} headerOnly />}
    <div className="msg msg--cont">
      <span className="msg__gutter" aria-hidden="true" />
      <div className="msg__body reply-pending__status">
        {/* 读屏只在含义变化时播报：等待回复 → 继续处理。思考、工具、正文之间的停顿只改可见的动画，不重复播报 */}
        <span className="sr-only" role="status">{label}</span>
        {!quiet && <span className="reply-pending__live" aria-hidden="true"><Typing /><span>{label}</span></span>}
      </div>
    </div>
  </div>;
}
