/* ===== UI-AUDIT-02 UI-06：常见 cron 表达式转成自然语言 =====
 * 只解释能确定含义的五段式写法；解释不了返回 null，由调用方保留原值并标注需核对。
 * 星期只认英文缩写：lom-core 的 cron 按 Quartz 计数（1 = 周日），纯数字有歧义（见 D35）。 */

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const pad = (n: number) => String(n).padStart(2, '0');
const int = (v: string, min: number, max: number) => (/^\d{1,2}$/.test(v) && Number(v) >= min && Number(v) <= max ? Number(v) : null);
const list = (v: string, min: number, max: number) => {
  const xs = v.split(',').map(x => int(x, min, max));
  return xs.every((x): x is number => x !== null) ? xs : null;
};

export function describeCron(expr: string): string | null {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [mi, hr, dom, mon, dow] = f;
  if (mon !== '*') return null;
  const every = /^\*\/(\d{1,2})$/;
  if (hr === '*' && dom === '*' && dow === '*' && every.test(mi)) return `每 ${every.exec(mi)![1]} 分钟`;
  const m = int(mi, 0, 59);
  if (m === null) return null;
  if (dom === '*' && dow === '*' && every.test(hr)) return `每 ${every.exec(hr)![1]} 小时（第 ${m} 分）`;
  const h = int(hr, 0, 23);
  if (h === null) return null;
  const at = `${pad(h)}:${pad(m)}`;
  if (dom === '*' && dow === '*') return `每天 ${at}`;
  if (dom === '*') {
    const days = dow.toUpperCase().split(',').map(d => DOW.indexOf(d));
    return days.every(d => d >= 0) ? `每周${days.map(d => '日一二三四五六'[d]).join('、')} ${at}` : null;
  }
  const dates = dow === '*' ? list(dom, 1, 31) : null;
  return dates ? `每月 ${dates.join('、')} 日 ${at}` : null;
}

const ZONE_NAMES: Record<string, string> = { 'Asia/Shanghai': '北京时间', 'Asia/Chongqing': '北京时间', 'Asia/Hong_Kong': '香港时间', 'Asia/Taipei': '台北时间', 'Asia/Tokyo': '东京时间', UTC: 'UTC', 'Etc/UTC': 'UTC' };
export const zoneName = (tz: string) => ZONE_NAMES[tz] ?? tz;
