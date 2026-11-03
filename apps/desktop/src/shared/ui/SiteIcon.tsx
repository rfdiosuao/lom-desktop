import { createContext, useContext, useState, type ReactNode } from 'react';
import { iconAllowed, iconHost, safeIconUrl, siteIcon } from '@/shared/lib/siteIcons';
import { Icon } from './Icon';
import { cx } from '@/shared/lib/util';

/** CHAT-ACTIVITY-01：这一轮搜索返回过的站点；只有它们（和白名单）会自动请求图标 */
export const IconHosts = createContext<ReadonlySet<string>>(new Set());

function IconImage({ icons, fallback, imageClass }: { icons: string[]; fallback: ReactNode; imageClass?: string }) {
  const [failed, setFailed] = useState(0), [loaded, setLoaded] = useState(false), icon = icons[failed];
  return <>
    {(!icon || !loaded) && <span className="site-icon__fallback">{fallback}</span>}
    {icon && <img key={icon} className={cx(imageClass, loaded && 'is-loaded')} src={icon} width={16} height={16} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
      onLoad={() => setLoaded(true)} onError={() => { setLoaded(false); setFailed(n => n + 1); }} />}
  </>;
}

/** 工具、正文链接、搜索来源共享图标加载和失败降级；目标变化时重新加载。
 *  `searched`：调用方确认这个地址就是搜索结果本身（来源条）。其他地址按 `IconHosts` 和白名单决定，
 *  不在其中的只显示通用图标，不发出任何请求。 */
export function SiteIcon({ url, favicon, fallback = <Icon name="link" />, imageClass, searched = false }: { url: string; favicon?: string; fallback?: ReactNode; imageClass?: string; searched?: boolean }) {
  const hosts = useContext(IconHosts), trusted = searched ? new Set([iconHost(url)]) : hosts;
  const icons = iconAllowed(url, trusted) ? [safeIconUrl(favicon), siteIcon(url, trusted)].filter((x, i, all): x is string => !!x && all.indexOf(x) === i) : [];
  return <span className={cx('site-icon', /^https:\/\/(?:www\.)?github\.com(?:\/|$)/i.test(url) && 'site-icon--github')} aria-hidden="true"><IconImage key={icons.join('|')} icons={icons} fallback={fallback} imageClass={imageClass} /></span>;
}
