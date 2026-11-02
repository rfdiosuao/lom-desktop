import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@/shared/ui/Icon';
import { cx } from '@/shared/lib/util';
import { openExternalUrl } from '@/core/links';
import { toastError } from '@/shared/overlays/controller';
import { siteIcon, type SearchSource } from '../runtime/searchSources';

/* ===== 联网搜索来源条：工具组下方一行站点，点开看完整列表 ===== */

const TONE_COUNT = 4;

/** 域名稳定哈希：同一站点始终用同一种色块 */
export function sourceTone(domain: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < domain.length; i++) {
    h ^= domain.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % TONE_COUNT;
}

function domainOf(url: string) {
  try { return new URL(url).hostname; } catch { return ''; }
}

/** 先用搜索结果自带的图标，没有或加载失败再用网站自己的 /favicon.ico，都不行才显示首字母 */
function SourceMark({ source, domain }: { source: SearchSource; domain: string }) {
  const icons = [source.favicon, siteIcon(source.url)].filter((icon, i, all): icon is string => !!icon && all.indexOf(icon) === i);
  const [failed, setFailed] = useState(0);
  const letter = Array.from(source.site || domain)[0]?.toUpperCase() || '?';
  const icon = icons[failed];
  return (
    <span className={cx('src-mark', `src-mark--${sourceTone(domain)}`)}>
      {icon
        ? <img key={icon} className="src-mark__img" src={icon} alt="" width={16} height={16}
          loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(n => n + 1)} />
        : <span className="src-mark__letter">{letter}</span>}
    </span>
  );
}

function Chip({ source }: { source: SearchSource }) {
  return (
    <span className="src-chip">
      <SourceMark source={source} domain={domainOf(source.url)} />
      <span className="src-chip__name">{source.site}</span>
    </span>
  );
}

export function SearchSources({ sources }: { sources: SearchSource[] }) {
  const [open, setOpen] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const viewport = useRef<HTMLSpanElement>(null);
  const group = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  const urlKey = sources.map(source => source.url).join('|');

  useEffect(() => {
    const view = viewport.current, content = group.current;
    if (!view || !content) return;
    const measure = () => setScrolling(content.scrollWidth > view.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(view);
    observer.observe(content);
    return () => observer.disconnect();
  }, [urlKey]);

  if (!sources.length) return null;
  const chips = sources.map(source => <Chip key={source.url} source={source} />);
  return (
    <div className="search-sources">
      <button type="button" className={cx('search-sources__bar', open && 'is-open')}
        aria-expanded={open} aria-controls={open ? panelId : undefined} aria-label={`来源 ${sources.length} 个网页`}
        onClick={() => setOpen(v => !v)}>
        <span className="search-sources__caption">
          <Icon name="globe" /><span>来源</span><span className="search-sources__count">{sources.length}</span>
        </span>
        <span className="search-sources__viewport" ref={viewport}>
          <span className={cx('search-sources__track', scrolling && 'is-scrolling')}>
            <span className="search-sources__group" ref={group}>{chips}</span>
            {scrolling && <span className="search-sources__group" aria-hidden="true">{chips}</span>}
          </span>
        </span>
        <Icon name="chevron" className={cx('search-sources__chev', open && 'is-open')} />
      </button>
      {open && (
        <ul className="search-sources__panel" id={panelId}>
          {sources.map(source => (
            <li key={source.url} className="search-sources__item">
              <a className="search-sources__link" href={source.url} title={source.url}
                onClick={e => { e.preventDefault(); void openExternalUrl(source.url).catch(error => toastError('打开链接失败', error)); }}
                onAuxClick={e => e.preventDefault()}>
                <SourceMark source={source} domain={domainOf(source.url)} />
                <span className="search-sources__meta">
                  <span className="search-sources__title">{source.title}</span>
                  <span className="search-sources__url">{source.url}</span>
                </span>
                <span className="search-sources__site">{source.site}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
