/* ===== REFACTOR-01 模块 7（#280）：账号范围的本机缓存读写 =====
 * 各模块原来直接调 localStorage：坏 JSON 有的抛错、有的吞掉；写满时有的报原始异常、有的中断流程。
 * 这里统一成明确的结果，不抛错：
 * - 读：ok / missing / invalid（内容损坏或版本不认识）/ unavailable（存储被禁用）；
 * - 写：ok / quota（写满）/ unavailable；
 * - 损坏的原文从不在这里删除；需要覆盖前先另存到 `<键>.invalid`，供恢复。
 * 键名保持各模块原样，迁移时不改变已有数据的位置。 */

export type CacheRead<T> = { status: 'ok'; value: T } | { status: 'missing' } | { status: 'invalid'; raw: string } | { status: 'unavailable' };
export type CacheWrite = 'ok' | 'quota' | 'unavailable';

/** validate 返回 undefined 表示内容不可用（结构不对、版本不认识） */
export function readJson<T>(key: string, validate: (value: unknown) => T | undefined): CacheRead<T> {
  let raw: string | null;
  try { raw = localStorage.getItem(key); } catch { return { status: 'unavailable' }; }
  if (raw === null) return { status: 'missing' };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { status: 'invalid', raw }; }
  const value = validate(parsed);
  return value === undefined ? { status: 'invalid', raw } : { status: 'ok', value };
}

export function writeJson(key: string, value: unknown): CacheWrite {
  try { localStorage.setItem(key, JSON.stringify(value)); return 'ok'; }
  catch (e) { return e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22) ? 'quota' : /quota/i.test(String(e)) ? 'quota' : 'unavailable'; }
}

/** 覆盖损坏内容之前另存原文；已经另存过同样的内容就不再写 */
export function keepInvalid(key: string, raw: string): CacheWrite {
  try { if (localStorage.getItem(`${key}.invalid`) === raw) return 'ok'; localStorage.setItem(`${key}.invalid`, raw); return 'ok'; }
  catch (e) { return /quota/i.test(String(e)) ? 'quota' : 'unavailable'; }
}

export const cacheWriteError = (result: CacheWrite) => (result === 'quota' ? '本机存储已满' : '本机存储不可用');
