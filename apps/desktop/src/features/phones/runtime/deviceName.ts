import { phoneRpc } from './phoneRpc';
import type { DeviceName } from '@/core/remoteWire';
import { S } from '@/state/store';
import { authAccount, type AuthGuard } from '@/features/account/runtime/authScope';
const active = new Map<string, { promise: Promise<void>; isCurrent: AuthGuard }>();
/** Serialize per device so a background refresh cannot overwrite a newer rename. */
export async function syncPhoneName(id: string, name: string): Promise<void> {
  const isCurrent = authAccount();
  const previous = active.get(id);
  if (previous?.isCurrent()) { try { await previous.promise; } catch { /* The newer name must still be attempted. */ } }
  if (!isCurrent() || S.agents[id]?.name !== name) throw new Error('设备名称或账号已更新，请重新同步');
  const request: DeviceName = { name };
  const job = (async () => {
    const result = await phoneRpc<DeviceName>(id, 'device.rename', request);
    if (!isCurrent() || result.name !== name) throw new Error('手机尚未确认新名称');
  })();
  const entry = { promise: job, isCurrent }; active.set(id, entry);
  try { await job; } finally { if (active.get(id) === entry) active.delete(id); }
}
