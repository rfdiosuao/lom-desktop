import { invoke, isTauri } from '@tauri-apps/api/core';

/* ===== 外部链接：只允许 http(s)；桌面外壳交给系统浏览器，浏览器预览打开新标签 ===== */

const MAX_URL_CHARS = 2048;
/** 与 Rust 的 web_link_open 保持同一拒绝集合：空白、控制字符、反斜杠 */
const UNSAFE_URL = /[\s\\\u0000-\u001f\u007f]/;

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

export function isHttpUrl(raw: string): boolean {
  const value = raw.trim();
  if (!value || UNSAFE_URL.test(value) || utf8Length(value) > MAX_URL_CHARS) return false;
  try {
    const parsed = new URL(value);
    if (UNSAFE_URL.test(parsed.href) || utf8Length(parsed.href) > MAX_URL_CHARS) return false;
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.hostname && !parsed.username && !parsed.password;
  } catch {
    return false; // 解析失败即拒绝，不把原始字符串交给系统
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isHttpUrl(url)) throw new Error('这个链接不能用浏览器打开');
  if (isTauri()) {
    await invoke('web_link_open', { url });
    return;
  }
  // noopener 下 window.open 可能返回 null，但新标签已经打开；不能把返回值当作拦截信号
  window.open(url, '_blank', 'noopener,noreferrer');
}
