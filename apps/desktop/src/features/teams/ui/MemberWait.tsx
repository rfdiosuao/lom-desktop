import { useEffect, useState } from 'react';
import type { Conv } from '@/state/types';
import { memberWait } from '../activity/memberWait';
import { Message } from '@/features/chat/ui/Message';

/** Opens the actual existing confirmation UI, without submitting or changing policy. */
export function MemberWait({ c, name }: { c?: Conv; name?: string }) {
  const [now, setNow] = useState(Date.now);
  const [expanded, setExpanded] = useState(false);
  const wait = memberWait(c, now);
  useEffect(() => {
    if (!wait) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [wait?.message.id]);
  if (!wait || !c) return null;
  return <div className="member-wait" role="status">
    <button type="button" className="act-card__more" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>
      {name ? `${name} · ` : ''}{wait.label}{wait.tool ? ` · ${wait.tool}` : ''} · 已等待 {wait.seconds} 秒 · {expanded ? '收起确认项' : '查看确认项'}
    </button>
    {expanded && <Message m={wait.message} ctxId={`conv:${c.id}`} />}
  </div>;
}
