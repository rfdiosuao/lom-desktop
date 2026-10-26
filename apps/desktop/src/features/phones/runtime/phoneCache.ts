import { S, update } from '@/state/store';
import type { Conv, Schedule } from '@/state/types';
import type { AppState } from '@/state/state';

/** Account-scoped local app cache. No provider configuration or credentials are stored here. */
let loadedAccount: string | null = null;
const prefix = 'lom.phone-cache.v1:';
/** schedules 是后加的字段：旧缓存里没有，读取时当作空 */
interface Cache { version: 1; convs: Conv[]; souls: Record<string, string>; memories: AppState['memories']; schedules?: Schedule[]; }
export function loadPhoneCache() {
  const id = S.cloud === 'signed-in' ? S.account?.id || null : null;
  if (id === loadedAccount) return;
  loadedAccount = id;
  update(s => {
    s.schedules = s.schedules.filter(x => !x.phoneTask);
    s.convs = s.convs.filter(c => !c.owner.startsWith('dev_'));
    for (const key of Object.keys(s.souls)) if (key.startsWith('dev_')) { delete s.souls[key]; delete s.memories[key]; }
    for (const key of Object.keys(s.soulDirty)) if (key.startsWith('dev_')) delete s.soulDirty[key];
  });
  if (!id) return;
  const raw = localStorage.getItem(prefix + id);
  if (!raw) return;
  const data: Cache = JSON.parse(raw);
  if (data.version !== 1 || !Array.isArray(data.convs)) throw new Error('手机本地缓存格式错误，请重新同步');
  update(s => {
    s.convs.push(...data.convs.filter(c => c.owner.startsWith('dev_')));
    Object.assign(s.souls, data.souls); Object.assign(s.memories, data.memories);
    // 手机离线时也能看到它的定时任务列表；手机上线后以手机为准重新同步
    s.schedules.push(...(data.schedules || []).filter(x => x.phoneTask && x.exec.startsWith('dev_') && !s.schedules.some(y => y.id === x.id)));
  });
}
export async function savePhoneCache(savedSouls: Record<string, string> = {}) {
  const id = S.account?.id;
  if (!id || S.cloud !== 'signed-in') return;
  const previous = JSON.parse(localStorage.getItem(prefix + id) || 'null') as Cache | null;
  const souls = Object.fromEntries(Object.entries(S.souls).filter(([key]) => key.startsWith('dev_') && !S.soulDirty[key]));
  for (const [key, text] of Object.entries(previous?.souls || {})) if (S.soulDirty[key]) souls[key] = text;
  Object.assign(souls, savedSouls);
  const data: Cache = { version: 1, convs: S.convs.filter(c => c.owner.startsWith('dev_')),
    souls,
    memories: Object.fromEntries(Object.entries(S.memories).filter(([key]) => key.startsWith('dev_'))),
    schedules: S.schedules.filter(x => x.phoneTask && x.exec.startsWith('dev_')) };
  try { localStorage.setItem(prefix + id, JSON.stringify(data)); }
  catch { throw new Error('手机内容已读取，但电脑本地缓存写入失败，请检查磁盘空间'); }
}
