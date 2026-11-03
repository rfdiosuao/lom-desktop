import { isHttpUrl } from '@/core/links';

const ICON_SERVICES = ['google.com', 'googleusercontent.com', 'clearbit.com', 'brandfetch.io', 'icon.horse', 'gstatic.com', 'duckduckgo.com', 'yandex.net'];

/** CHAT-ACTIVITY-01：不经搜索也自动加载图标的少数站点（明确的服务身份，如 GitHub 工具）。
 *  其他站点只有在同一轮搜索结果里出现过才加载，避免每个链接都向陌生网站发请求。 */
export const ICON_ALLOWLIST: ReadonlySet<string> = new Set(['github.com']);

/** 自动加载只使用公共 HTTPS 域名；打开链接本身仍由外部链接入口校验。 */
export function safeIconUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !isHttpUrl(raw)) return undefined;
  const url = new URL(raw.trim()), host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.port || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')) return undefined;
  if (/(?:^|\.)(?:localhost|local|internal|lan|home\.arpa)\.?$/.test(host)) return undefined;
  if (ICON_SERVICES.some(h => host === h || host.endsWith(`.${h}`))) return undefined;
  return url.href;
}

/** 用于比较的站点名：小写、去掉 www. */
export function iconHost(raw: string): string {
  try { return new URL(raw).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

/** 是否可以为这个地址自动请求图标：白名单站点，或调用方给出的可信站点（同一轮搜索返回的站点） */
export function iconAllowed(raw: string, trusted: ReadonlySet<string> = ICON_ALLOWLIST): boolean {
  const host = iconHost(raw);
  return !!host && (ICON_ALLOWLIST.has(host) || trusted.has(host));
}

/** 站点自己的 /favicon.ico；不在允许范围内或地址不安全时不给出（只显示通用图标、不发请求） */
export function siteIcon(raw: string, trusted?: ReadonlySet<string>): string | undefined {
  const url = safeIconUrl(raw);
  if (!url || !iconAllowed(url, trusted)) return undefined;
  return `${new URL(url).origin}/favicon.ico`;
}
