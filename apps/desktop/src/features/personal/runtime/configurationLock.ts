import { update } from '@/state/store';

/** All local runtime/config mutations for one assistant conversation serialize here. */
const owners = new Map<string, symbol>();
export const personalConfigUpdating = (id?: string) => !!id && owners.has(id);
export function lockPersonalConfiguration(id: string) {
  if (owners.has(id)) throw new Error('助理配置正在更新，请稍后重试');
  const token = Symbol(); owners.set(id, token); update();
  return (notify = true) => { if (owners.get(id) === token) { owners.delete(id); if (notify) update(); } };
}
