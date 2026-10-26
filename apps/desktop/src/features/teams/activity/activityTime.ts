/* D33 活动卡时间：紧凑、无歧义，悬停给出完整时间。nowMs 可注入，便于测试。 */

const pad = (n: number) => String(n).padStart(2, '0');

export function formatActivityTime(ms: number, nowMs: number = Date.now()): { label: string; full: string } {
  const d = new Date(ms);
  const now = new Date(nowMs);
  if (Number.isNaN(d.getTime())) return { label: '', full: '' };
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const label = sameDay ? time : d.getFullYear() === now.getFullYear() ? `${date.slice(5)} ${time}` : `${date} ${time}`;
  return { label, full: `${date} ${time}:${pad(d.getSeconds())}` };
}
