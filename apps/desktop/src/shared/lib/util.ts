/* ===== 通用小工具 ===== */

export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 9)}`;

export const fmtTime = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const ago = (t?: number | null) => {
  if (!t) return '—';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
};

export const basename = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

const slashed = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
const caseless = (p: string) => (/^[a-z]:/i.test(p) ? p.toLowerCase() : p);
/** path 在 root 之内时返回相对部分（保留原分隔符；等于 root 返回空串），否则返回 null。
 *  按路径段比较：`/a/proj2` 不在 `/a/proj` 之内；Windows 盘符路径不区分大小写。 */
export function relativeInside(path: string, root: string): string | null {
  const r = slashed(root), p = slashed(path);
  if (!r) return null;
  if (caseless(p) === caseless(r)) return '';
  return caseless(p).startsWith(`${caseless(r)}/`) ? path.slice(r.length + 1) : null;
}

/** 相对路径接到 root 后面（沿用 root 的分隔符）；已经是绝对路径或没有 root 时原样返回 */
export function absoluteIn(path: string, root: string): string {
  if (!root || /^(?:[a-z]:)?[\\/]|^~[\\/]/i.test(path)) return path;
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${sep}${path}`;
}

/** 路径显示：用户主目录缩写成 ~ */
export const prettyPath = (p: string, home?: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p);

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
