import { phoneRpc } from './phoneRpc';
import type { DeviceStatus } from '@/core/remoteWire';
import { update } from '@/state/store';
import { authAccount, type AuthGuard } from '@/features/account/runtime/authScope';
const active = new Map<string, AuthGuard>();
export function parseDeviceStatus(value: DeviceStatus) {
  const battery = /^\d{1,3}$/.test(value.battery) ? Number(value.battery) : NaN;
  const names: Record<string, string> = { wifi: 'Wi-Fi', cellular: '移动网络', ethernet: '有线网络', offline: '未联网' };
  return { battery: battery >= 0 && battery <= 100 ? battery : undefined, network: names[value.network] || '网络未知' };
}
export async function syncDeviceStatus(id: string) {
  if (active.get(id)?.()) return;
  const isCurrent = authAccount();
  if (!isCurrent()) return;
  active.set(id, isCurrent);
  try {
    const data = parseDeviceStatus(await phoneRpc<DeviceStatus>(id, 'device.status', {}));
    if (isCurrent()) update(s => { const a = s.agents[id]; if (a?.status === 'online') Object.assign(a, data); });
  } catch {
    // Old APKs and unavailable phones have no telemetry; never invent battery values.
    if (isCurrent()) update(s => { const a = s.agents[id]; if (a) { a.battery = undefined; a.network = '网络未知'; } });
  } finally { if (active.get(id) === isCurrent) active.delete(id); }
}
