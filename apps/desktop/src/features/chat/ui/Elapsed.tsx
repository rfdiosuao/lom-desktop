import { useEffect, useState } from 'react';
import type { Msg } from '@/state/types';
import { elapsedRange, elapsedText } from '../runtime/activityTiming';

export function Elapsed({ items, active, compact = false }: { items: Msg[]; active: boolean; compact?: boolean }) {
  const [, tick] = useState(0);
  const elapsed = elapsedRange(items, active, Date.now()), ticking = !!elapsed?.running;
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  const label = elapsed ? `${elapsed.running ? '已运行' : '用时'} ${elapsedText(elapsed.milliseconds, elapsed.running)}` : '耗时未知';
  // 可见文字就是读屏内容；普通 span 不加 aria-label
  return <span className="tool__elapsed" title={elapsed ? `${label} · 观测到的经过时间，包含等待工具响应；并行调用不相加` : '该记录缺少完整的开始或结束时间'}>
    {elapsed && compact ? elapsedText(elapsed.milliseconds, elapsed.running) : label}
  </span>;
}
