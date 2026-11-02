import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchSources } from './SearchSources';
import type { SearchSource } from '../runtime/searchSources';

const open = vi.fn();
vi.mock('@/core/links', () => ({ openExternalUrl: async (...args: unknown[]) => { open(...args); } }));

const sources: SearchSource[] = [
  { url: 'https://example.com/a', title: '示例文章', site: 'example.com', favicon: 'https://example.com/favicon.ico' },
  { url: 'https://news.example.org/b', title: '另一篇', site: 'news' },
];

let host: HTMLDivElement, root: Root;

const render = async (list: SearchSource[] = sources) => {
  await act(async () => root.render(<SearchSources sources={list} />));
};

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  open.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('D31 AC-3/AC-4 来源条默认展示', () => {
  it('renders one row with site names and only https favicons', async () => {
    await render();
    expect(host.querySelectorAll('.src-chip')).toHaveLength(2);
    expect(host.textContent).toContain('example.com');
    expect(host.textContent).toContain('news');
    const image = host.querySelector('img.src-mark__img') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe('https://example.com/favicon.ico');
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(image.getAttribute('loading')).toBe('lazy');
    // 结果没带图标的站点改用网站自己的 /favicon.ico（元宝轻量版不返回图标），加载失败才退回首字母
    const second = host.querySelectorAll('.src-chip')[1].querySelector('img.src-mark__img')!;
    expect(second.getAttribute('src')).toBe('https://news.example.org/favicon.ico');
    await act(async () => { second.dispatchEvent(new Event('error')); });
    expect(host.querySelectorAll('.src-chip')[1].querySelector('.src-mark__letter')?.textContent).toBe('N');
  });

  it('EXT-SEARCH a broken result icon falls back to the site icon before the letter', async () => {
    await render([{ url: 'https://docs.example.net/x', title: '文档', site: 'docs', favicon: 'https://cdn.example.net/broken.png' }]);
    const first = host.querySelector('img.src-mark__img')!;
    expect(first.getAttribute('src')).toBe('https://cdn.example.net/broken.png');
    await act(async () => { first.dispatchEvent(new Event('error')); });
    expect(host.querySelector('img.src-mark__img')?.getAttribute('src')).toBe('https://docs.example.net/favicon.ico');
    await act(async () => { host.querySelector('img.src-mark__img')!.dispatchEvent(new Event('error')); });
    expect(host.querySelector('.src-mark__letter')?.textContent).toBe('D');
  });

  it('falls back to the first letter when the favicon fails', async () => {
    await render([sources[0]]);
    const image = host.querySelector('img.src-mark__img')!;
    await act(async () => { image.dispatchEvent(new Event('error')); });
    expect(host.querySelector('img.src-mark__img')).toBeNull();
    expect(host.querySelector('.src-mark__letter')?.textContent).toBe('E');
  });

  it('uses the same color for the same domain and a different color for another domain', async () => {
    await render([
      { url: 'https://example.com/a', title: 'A', site: 'example.com' },
      { url: 'https://example.com/b', title: 'B', site: 'example.com' },
      { url: 'https://a.example/1', title: 'C', site: 'a.example' },
    ]);
    const marks = [...host.querySelectorAll('.src-mark')].map(el => el.className);
    expect(marks[0]).toBe(marks[1]);
    expect(marks[0]).not.toBe(marks[2]);
  });

  it('renders nothing without sources', async () => {
    await render([]);
    expect(host.querySelector('.search-sources')).toBeNull();
  });
});

describe('D31 AC-6/AC-7 展开与打开链接', () => {
  it('expands the full list from the bar button and collapses again', async () => {
    await render();
    const bar = host.querySelector('.search-sources__bar') as HTMLButtonElement;
    expect(bar.getAttribute('aria-expanded')).toBe('false');
    expect(bar.getAttribute('aria-controls')).toBeNull();
    expect(host.querySelector('.search-sources__panel')).toBeNull();

    await act(async () => { bar.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    expect(bar.getAttribute('aria-expanded')).toBe('true');
    expect(bar.getAttribute('aria-controls')).toBe(host.querySelector('.search-sources__panel')?.id);
    const links = [...host.querySelectorAll<HTMLAnchorElement>('.search-sources__link')];
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('https://example.com/a');
    expect(links[0].textContent).toContain('示例文章');
    expect(links[0].textContent).toContain('https://example.com/a');

    await act(async () => { bar.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    expect(bar.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('.search-sources__panel')).toBeNull();
  });

  it('opens the clicked source through the external link adapter', async () => {
    await render();
    const bar = host.querySelector('.search-sources__bar') as HTMLButtonElement;
    await act(async () => { bar.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    const link = host.querySelector('.search-sources__link') as HTMLAnchorElement;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    await act(async () => { link.dispatchEvent(event); });
    expect(open).toHaveBeenCalledWith('https://example.com/a');
    expect(event.defaultPrevented).toBe(true);

    const aux = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });
    await act(async () => { link.dispatchEvent(aux); });
    expect(aux.defaultPrevented).toBe(true);
  });
});
