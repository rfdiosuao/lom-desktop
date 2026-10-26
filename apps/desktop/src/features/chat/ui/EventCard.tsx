import type { ReactNode } from 'react';
import type { Msg } from '@/state/types';
import { useStore } from '@/state/store';
import { toggleEvent } from '../actions/conversations';
import { IconTile } from '@/shared/ui/Layout';
import { Badge, Spinner } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { cx } from '@/shared/lib/util';

export function EventCard({ m, tone, ic, title, sub, body, foot, toggle = true }: {
  m: Msg; tone?: 'warn' | 'info' | 'brand'; ic: string; title: ReactNode; sub?: ReactNode; body?: ReactNode; foot?: ReactNode; toggle?: boolean;
}) {
  const s = useStore();
  const open = !!s.eventOpen[m.id];
  const canToggle = toggle && !!body;
  const headInner = <>
    <IconTile ic={ic} />
    <span className="event__title">{title}{sub ? <small>{sub}</small> : null}</span>
    {m.status === 'running' || m.status === 'submitting' ? <Spinner /> : m.status === 'error' ? <Badge text="失败" tone="danger" /> : null}
    {canToggle && <Icon name="chevron" className="event__chev" />}
  </>;
  return <div className={cx('event', tone && `event--${tone}`, open && 'is-open')}>
    {canToggle
      ? <button type="button" className="event__head" onClick={() => toggleEvent(m.id)} aria-expanded={open}>{headInner}</button>
      : <div className="event__head">{headInner}</div>}
    {(open || !toggle) && body ? <div className="event__body">{body}</div> : null}
    {foot ? <div className="event__foot">{foot}</div> : null}
  </div>;
}
