import { beforeEach, expect, it, vi } from 'vitest';
import { isHttpUrl, openExternalUrl } from './links';

const native = vi.hoisted(() => ({ tauri: false, invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => native.tauri,
  invoke: (...args: unknown[]) => native.invoke(...args),
}));

beforeEach(() => {
  native.tauri = false;
  native.invoke.mockReset();
  vi.restoreAllMocks();
});

it('D31 AC-7 only accepts plain http(s) links', () => {
  expect(isHttpUrl('https://example.com/a')).toBe(true);
  expect(isHttpUrl('http://example.com')).toBe(true);
  expect(isHttpUrl('javascript:alert(1)')).toBe(false);
  expect(isHttpUrl('file:///etc/passwd')).toBe(false);
  expect(isHttpUrl('data:text/html,hello')).toBe(false);
  expect(isHttpUrl('https://user:pass@example.com/')).toBe(false);
});

it('D31 AC-7 rejects unsafe characters and enforces the 2048-byte boundary', () => {
  expect(isHttpUrl('https://example.com\\@evil.com/')).toBe(false);
  expect(isHttpUrl('https://example.com/a\tb')).toBe(false);
  expect(isHttpUrl('https://example.com/a b')).toBe(false);
  const exact = `https://example.com/${'a'.repeat(2028)}`;
  expect(exact.length).toBe(2048);
  expect(isHttpUrl(exact)).toBe(true);
  expect(isHttpUrl(`${exact}a`)).toBe(false);
});

it('D31 AC-7 opens a new tab in the browser preview and does not treat null as a failure', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  await expect(openExternalUrl('https://example.com/a')).resolves.toBeUndefined();
  expect(open).toHaveBeenCalledWith('https://example.com/a', '_blank', 'noopener,noreferrer');
});

it('D31 AC-7 uses web_link_open in the desktop shell', async () => {
  native.tauri = true;
  const open = vi.spyOn(window, 'open');
  await openExternalUrl('https://example.com/a');
  expect(native.invoke).toHaveBeenCalledWith('web_link_open', { url: 'https://example.com/a' });
  expect(open).not.toHaveBeenCalled();
});
