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

/** 路径显示：用户主目录缩写成 ~ */
export const prettyPath = (p: string, home?: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p);

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
