import { authAccount } from '@/features/account/runtime/authScope';
import { phoneRpc } from './phoneRpc';
import { applyCapabilities, beginCapabilities, capabilitiesPending, CAPABILITIES_METHOD, endCapabilities, markLegacyPhone, type DeviceCapabilities } from './phoneCapabilities';

/** 读取失败（不是「不支持」）后多久再试：期间按老手机处理，不隐藏任何入口 */
const RETRY_MS = 60_000;

/** 配对或连上时调用一次 `device.capabilities`，结果按设备缓存。已经问到结果的设备不重复问。 */
export async function ensurePhoneCapabilities(id: string) {
  if (!capabilitiesPending(id)) return;
  const current = authAccount();
  if (!current()) return;
  beginCapabilities(id);
  let retry = 0;
  try {
    const value = await phoneRpc<DeviceCapabilities>(id, CAPABILITIES_METHOD, {});
    if (current()) applyCapabilities(id, value);
  } catch (error) {
    if ((error as { code?: string } | null)?.code === 'remote.method_unknown') {
      if (current()) markLegacyPhone(id); // 老手机：没有这个方法，按全部支持处理
    } else {
      // 读不到不等于「全部不支持」：按老手机处理并记录，稍后再问
      retry = RETRY_MS;
      console.warn('读取手机能力清单失败，暂按老手机处理', error);
    }
  } finally { endCapabilities(id, retry); }
}
