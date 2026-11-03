import type { Msg } from '@/state/types';
import { safeIconUrl } from '@/shared/lib/siteIcons';

/** 只识别明确的服务身份或 URL 参数，不从任意输出/搜索词推测站点。 */
export function toolSite(m: Msg): string | undefined {
  const command = m.command || (typeof m.args?.command === 'string' ? m.args.command : m.detail) || '';
  if (/github/i.test(m.toolName || '') || /^gh\s/.test(command.trim())) return 'https://github.com/';
  const url = m.args?.url;
  // 是否真的加载图标由 SiteIcon 按本轮搜索站点与白名单决定
  return typeof url === 'string' && safeIconUrl(url) ? url : undefined;
}

export function toolState(m: Msg) {
  const states: Record<string, { label: string; icon: string }> = {
    done: { label: '已完成', icon: 'check' }, error: { label: '失败', icon: 'close' },
    running: { label: '正在执行', icon: 'play' }, queued: { label: '排队中', icon: 'clock' },
    pending: { label: '等待确认', icon: 'clock' }, unconfirmed: { label: '等待确认', icon: 'help' },
    cancelled: { label: '已取消', icon: 'minus' },
  };
  return states[m.status || ''] ?? { label: '状态未知', icon: 'help' };
}
