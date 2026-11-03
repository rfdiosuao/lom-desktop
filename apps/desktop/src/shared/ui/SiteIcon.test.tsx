import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Markdown } from './Markdown';
import { IconHosts } from './SiteIcon';

let host: HTMLDivElement, root: Root;
const render = async (text: string, searched: string[] = []) => act(async () => root.render(<IconHosts.Provider value={new Set(searched)}><Markdown text={text} /></IconHosts.Provider>));
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('CHAT-ACTIVITY-01 AC-5 a link to an arbitrary site shows the generic icon and requests nothing', async () => {
  await render('[Qoder](https://qoder.com/) [文章](https://news.example.org/a)');
  expect(host.querySelector('img')).toBeNull();
  expect(host.querySelectorAll('a .site-icon .icon')).toHaveLength(2);
});

it('CHAT-ACTIVITY-01 AC-5 a site returned by this turn\'s search loads its own favicon', async () => {
  await render('[文章](https://www.news.example.org/a) [其他](https://other.example.com/)', ['news.example.org']);
  const images = [...host.querySelectorAll('a img')];
  expect(images.map(x => x.getAttribute('src'))).toEqual(['https://www.news.example.org/favicon.ico']);
});

it('CHAT-ACTIVITY-01 AC-5 shows a fallback while the image loads and replaces it after load', async () => {
  await render('[项目](https://github.com/rfdiosuao/lom)');
  expect(host.querySelector('a .site-icon .icon')).not.toBeNull();
  await act(async () => host.querySelector('a img')!.dispatchEvent(new Event('load')));
  expect(host.querySelector('a .site-icon .icon')).toBeNull();
});

it('CHAT-ACTIVITY-01 AC-5/6 renders an icon in formatted links and retains a fallback after failure', async () => {
  await render('[**项目**](https://github.com/rfdiosuao/lom)');
  const image = host.querySelector('a img')!;
  expect(image).not.toBeNull(); expect(image.getAttribute('src')).toBe('https://github.com/favicon.ico');
  expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(host.querySelector('a b')?.textContent).toBe('项目');
  await act(async () => image.dispatchEvent(new Event('error')));
  expect(host.querySelector('a img')).toBeNull(); expect(host.querySelector('a .site-icon .icon')).not.toBeNull();
  expect(host.querySelector('a')?.getAttribute('href')).toBe('https://github.com/rfdiosuao/lom');
  await render('[**项目**](https://example.com/new)', ['example.com']);
  expect(host.querySelector('a img')?.getAttribute('src')).toBe('https://example.com/favicon.ico');
});

it('CHAT-ACTIVITY-01 AC-5/6 does not request icons for code, local addresses or credentialed URLs', async () => {
  await render('`https://github.com/code` [本地](https://127.0.0.1/private) [内网](https://192.168.1.2/path) [IPv6](https://[::1]/) [账号](https://user:pass@example.com/) [端口](https://example.com:8443/) [HTTP](http://example.com/)', ['example.com', '127.0.0.1', '192.168.1.2']);
  expect(host.querySelector('img')).toBeNull();
  expect(host.querySelector('code')?.textContent).toBe('https://github.com/code');
});
