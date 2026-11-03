import type { ReactNode } from 'react';
import type { Msg } from '@/state/types';
import { Message, type FenceCarry } from './Message';
import { ToolCalls } from './ToolCalls';
import { ActivityGroup } from './ActivityGroup';
import { conv } from '@/state/selectors';
import { useStore } from '@/state/store';
import { visibleReply } from '../runtime/commands';
import { openFenceAtEnd } from '@/shared/ui/markdownBlocks';
import { regenerate } from '../actions/composer';
import { IconBtn } from '@/shared/ui/Button';
import { toast, toastError } from '@/shared/overlays/controller';
import { hasInFlightSend, hasUnconfirmedSend, isTaskStopping } from '../runtime/cancel';
import { searchHostsOf } from '../runtime/searchSources';
import { IconHosts } from '@/shared/ui/SiteIcon';

/* ===== 一段对话的消息列表（对话页、团队窗格、侧聊共用）=====
 * 连着的工具调用合成一组；同一条助手回复被工具/思考切段时，整轮只在末尾显示一次复制/重新生成。 */

const copyReply = async (text: string) => {
  if (!text) { toast('这段回复没有可复制的文字', 'info'); return; }
  try {
    if (!navigator.clipboard) throw new Error('剪贴板不可用');
    await navigator.clipboard.writeText(text);
    toast('已复制整段回复');
  } catch (e) { toastError('复制失败', e); }
};

function TurnActions({ ctxId, reply, text }: { ctxId: string; reply: Msg; text: string }) {
  return (
    <div className="msg msg--actions">
      <span className="msg__gutter" aria-hidden="true" />
      <div className="msg__body">
        <div className="row" style={{ gap: 2 }}>
          <IconBtn ic="copy" label="复制" onClick={() => void copyReply(text)} size="sm" disabled={!text} />
          <IconBtn ic="refresh" label="重新生成" onClick={() => regenerate(ctxId, reply)} size="sm" />
        </div>
      </div>
    </div>
  );
}

/** 流式、工具运行、等待确认/回答时都不算整轮完成 */
function turnFinished(turn: Msg[], running: boolean) {
  if (running || turn.some(m => m.streaming)) return false;
  if (turn.some(m => m.type === 'tool' && ['running', 'pending', 'queued', 'unconfirmed'].includes(m.status || ''))) return false;
  return !turn.some(m => (m.type === 'approval' || m.type === 'question') && ['pending', 'submitting', 'unconfirmed'].includes(m.status || ''));
}

function replyText(turn: Msg[]) {
  return turn.filter(m => m.type === 'assistant')
    .map(m => visibleReply(m.text || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

/** CW06：同一轮里被工具切开的几段正文，代码围栏在段间接续。上一段停在围栏里、下一段才闭合时，
 *  上一段先按代码块渲染，下一段从代码块里开始，前后残段不会各自把围栏符号漏成正文。 */
function fenceCarry(turn: Msg[]): Map<string, FenceCarry> {
  const out = new Map<string, FenceCarry>();
  const replies = turn.filter(m => m.type === 'assistant');
  let open: number | undefined;
  replies.forEach((m, i) => {
    const end = openFenceAtEnd(visibleReply(m.text, m.streaming), open);
    const continues = !!end && i < replies.length - 1;
    if (open || continues) out.set(m.id, { from: open, openEnd: continues });
    open = end;
  });
  return out;
}

const isActivity = (m: Msg) => m.type === 'thinking' || m.type === 'tool' || m.type === 'files';

/** UI-AUDIT-05：卡片式消息放进与正文相同的头像列 + 正文列，左边缘和正文对齐。
 *  工具组、执行过程和桌面紧凑思考自己按 --msg-indent 缩进，不再包一层，避免双重缩进。 */
function Indented({ children }: { children: ReactNode }) {
  return <div className="msg msg--event"><span className="msg__gutter" aria-hidden="true" /><div className="msg__body">{children}</div></div>;
}
const CARD_TYPES = new Set<Msg['type']>(['plan', 'question', 'approval', 'files', 'delegate', 'teammate', 'handoff', 'schedule']);
/** 正文、用户消息、系统提示和桌面紧凑思考不算卡片 */
const isCard = (m: Msg, compactThinking: boolean) => CARD_TYPES.has(m.type) || (m.type === 'thinking' && !compactThinking);

interface TurnView { ctxId: string; desktopReply: boolean; settled: boolean; last: boolean }


/** 一轮（两条用户消息之间）的显示：思考、工具与文件改动连成一个执行过程，其他消息按原顺序 */
function turnNodes(turn: Msg[], { ctxId, desktopReply, settled, last }: TurnView): ReactNode[] {
  // UI-AUDIT-05 F-10：这一轮还没结束时，其中的工具组和执行过程默认保持展开
  const out: ReactNode[] = [], fences = fenceCarry(turn), live = last && !settled;
  let speaker: string | undefined;
  for (let j = 0; j < turn.length;) {
    const m = turn[j];
    if (desktopReply && !speaker && isActivity(m)) {
      // Start the identity at the first activity, even before streamed text arrives.
      const reply = turn.find(item => item.type === 'assistant');
      speaker = reply?.agent ?? reply?.role ?? 'self';
      out.push(<Message key={`identity:${m.id}`} m={{ ...m, type: 'assistant', agent: reply?.agent, role: reply?.role }} ctxId={ctxId} headerOnly />);
    }
    if (desktopReply && isActivity(m)) {
      let k = j;
      while (k < turn.length && isActivity(turn[k])) k++;
      const activity = turn.slice(j, k);
      if (activity.some(m => m.type === 'files') || (activity.some(m => m.type === 'thinking') && activity.some(m => m.type === 'tool'))) {
        out.push(<ActivityGroup key={`activity:${m.id}`} items={activity} ctxId={ctxId} live={live} active={last && k === turn.length && !!(activity.at(-1)?.streaming || activity.at(-1)?.status === 'running')} />);
        j = k;
        continue;
      }
    }
    if (m.type === 'tool') {
      let k = j;
      while (k < turn.length && turn[k].type === 'tool') k++;
      out.push(<ToolCalls key={`tools:${m.id}`} items={turn.slice(j, k)} ctxId={ctxId} live={live} />);
      j = k;
      continue;
    }
    const who = m.type === 'assistant' ? m.agent ?? m.role ?? 'self' : undefined;
    const node = <Message key={m.id} m={m} ctxId={ctxId} continued={!!who && who === speaker} compactThinking={desktopReply} fence={fences.get(m.id)} thinkingActive={last && j === turn.length - 1 && !!(m.streaming || m.status === 'running')} />;
    out.push(isCard(m, desktopReply) ? <Indented key={m.id}>{node}</Indented> : node);
    if (who) speaker = who;
    j++;
  }
  const reply = turn.findLast(m => m.type === 'assistant');
  if (reply && turnFinished(turn, last && !settled)) out.push(<TurnActions key={`actions:${reply.id}`} ctxId={ctxId} reply={reply} text={replyText(turn)} />);
  return out;
}

export function MessageList({ msgs, ctxId }: { msgs: Msg[]; ctxId: string }) {
  const s = useStore();
  const c = conv(ctxId.replace(/^conv:/, ''));
  const desktopReply = !!c && c.owner === 'pc' && !c.phoneSession;
  const unsettled = !!c && (!!s.running[c.id] || hasInFlightSend(c.id) || hasUnconfirmedSend(c.id) || isTaskStopping(c.id));
  const out: ReactNode[] = [];
  for (let i = 0; i < msgs.length;) {
    if (msgs[i].type === 'user') { out.push(<Message key={msgs[i].id} m={msgs[i]} ctxId={ctxId} />); i++; continue; }
    let end = i;
    while (end < msgs.length && msgs[end].type !== 'user') end++;
    const turn = msgs.slice(i, end);
    // CHAT-ACTIVITY-01：这一轮搜索返回过的站点，链接和工具行才自动加载站点图标
    out.push(<IconHosts.Provider key={`turn:${turn[0].id}`} value={searchHostsOf(turn)}>
      {turnNodes(turn, { ctxId, desktopReply, settled: !unsettled, last: end === msgs.length })}
    </IconHosts.Provider>);
    i = end;
  }
  return <>{out}</>;
}
