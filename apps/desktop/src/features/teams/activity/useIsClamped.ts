import { useLayoutEffect, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';

/* D33 卡片正文截断：按实际布局测量是否溢出，而不是猜字符数。
 * 没有布局信息时（例如 jsdom）退回字符数估算，避免把展开入口藏掉。 */

const TOLERANCE_PX = 1;
const FALLBACK_CHARS = 120;

export const clampStyle = (rows: number): CSSProperties => ({
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: rows,
  overflow: 'hidden',
});

export function useIsClamped(ref: RefObject<HTMLElement | null>, deps: unknown[]): boolean {
  const [clamped, setClamped] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (el.scrollHeight === 0 && el.clientHeight === 0) setClamped((el.textContent?.length ?? 0) > FALLBACK_CHARS);
      else setClamped(el.scrollHeight > el.clientHeight + TOLERANCE_PX);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return clamped;
}
