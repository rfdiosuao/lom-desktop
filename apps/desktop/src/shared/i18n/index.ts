import { S } from '@/state/store';
import { EN } from './locales/en';

/** Only application-owned control strings use this function. Never traverse rendered user content. */
export function t<T>(value: T): T {
  if (S.prefs.lang !== 'English' || typeof value !== 'string') return value;
  if (EN[value]) return EN[value] as T;
  const interval = /^每 (\d+) 分钟$/.exec(value);
  if (interval) return `Every ${interval[1]} min` as T;
  return value;
}
