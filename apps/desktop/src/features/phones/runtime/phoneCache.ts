import { toast } from '@/shared/overlays/controller';
import { readJson, writeJson } from '@/features/account/runtime/localCache';
import { S, update } from '@/state/store';
import type { Conv, Schedule } from '@/state/types';
import type { AppState } from '@/state/state';

/** Account-scoped local app cache. No provider configuration or credentials are stored here. */
let loadedAccount: string | null = null;
const prefix = 'lom.phone-cache.v1:';
/** schedules 是后加的字段：旧缓存里没有，读取时当作空 */
interface Cache { version: 1; convs: Conv[]; souls: Record<string, string>; memories: AppState['memories']; schedules?: Schedule[]; }
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
function validCache(data: unknown): Cache | undefined {
  if (!record(data) || data.version !== 1 || !Array.isArray(data.convs)
    || data.convs.some(c => !record(c) || typeof c.owner !== 'string')
    || !record(data.souls) || Object.values(data.souls).some(x => typeof x !== 'string')
    || !record(data.memories) || (data.schedules !== undefined && (!Array.isArray(data.schedules)
      || data.schedules.some(x => !record(x) || typeof x.exec !== 'string')))) return undefined;
  return data as unknown as Cache;
}
/** REFACTOR-01 模块 7：读取结果明确区分没有缓存、损坏、存储不可用；损坏的原文保留不覆盖（PHONE-CACHE-01） */
const readCache = (id: string) => readJson(prefix + id, validCache);
/** 同步循环每 2 秒会重试读取：同一账号、同样的问题只提示一次 */
let reported = '';
export function loadPhoneCache() {
  const id = S.cloud === 'signed-in' ? S.account?.id || null : null;
  if (id === loadedAccount) return;
  loadedAccount = null;
  update(s => {
    s.schedules = s.schedules.filter(x => !x.phoneTask);
    s.convs = s.convs.filter(c => !c.owner.startsWith('dev_'));
    for (const key of Object.keys(s.souls)) if (key.startsWith('dev_')) { delete s.souls[key]; delete s.memories[key]; }
    for (const key of Object.keys(s.soulDirty)) if (key.startsWith('dev_')) delete s.soulDirty[key];
  });
  if (!id) return;
  const read = readCache(id);
  if (read.status === 'invalid' || read.status === 'unavailable') {
    // Preserve recovery data and allow same-account retry; cache failure is not authentication failure.
    const problem = `${id}:${read.status}:${read.status === 'invalid' ? read.raw : ''}`;
    if (reported !== problem) { reported = problem; toast('phone.cache_unavailable：手机本地缓存无法读取，原数据已保留，请重新同步', 'info'); }
    return;
  }
  reported = '';
  loadedAccount = id;
  if (read.status === 'missing') return;
  const data = read.value;
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
  const read = readCache(id);
  if (read.status === 'invalid' || read.status === 'unavailable') throw new Error('phone.cache_unavailable：原手机缓存无法读取，未覆盖原数据');
  const previous = read.status === 'ok' ? read.value : null;
  const souls = Object.fromEntries(Object.entries(S.souls).filter(([key]) => key.startsWith('dev_') && !S.soulDirty[key]));
  for (const [key, text] of Object.entries(previous?.souls || {})) if (S.soulDirty[key]) souls[key] = text;
  Object.assign(souls, savedSouls);
  const data: Cache = { version: 1, convs: S.convs.filter(c => c.owner.startsWith('dev_')),
    souls,
    memories: Object.fromEntries(Object.entries(S.memories).filter(([key]) => key.startsWith('dev_'))),
    schedules: S.schedules.filter(x => x.phoneTask && x.exec.startsWith('dev_')) };
  if (writeJson(prefix + id, data) !== 'ok') throw new Error('手机内容已读取，但电脑本地缓存写入失败，请检查磁盘空间');
}
