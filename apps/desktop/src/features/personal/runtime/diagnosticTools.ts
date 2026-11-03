import { DIAGNOSTIC_TOOLS } from './managementCatalog';
import { phoneRpc } from '@/features/phones/runtime/phoneRpc';
import { screenError } from '@/features/phones/runtime/phoneScreen';
import { viewImageTool } from '@/features/chat/runtime/vision';
import { S } from '@/state/store';
const result = (value: unknown, isError = false) => ({ isError, content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });
/** Read-only paired-device discovery. Caller supplies the account and running-scope guard. */
export async function personalDiagnosticTool(name: string, args: Record<string, unknown>, current: () => boolean) {
  if (!DIAGNOSTIC_TOOLS.includes(name)) return null;
  try {
    if (!current()) throw new Error('个人助理未运行或账号已变化');
    if (name === 'lom_view_image') {
      const image = await viewImageTool(args, current);
      if (!current()) throw new Error('个人助理已停止，未返回图片描述');
      return image;
    }
    const paired = () => Object.values(S.agents).filter(a => a.real);
    if (name === 'phone_list') return result(paired().map(a => ({ id: a.id, name: a.name, status: a.status })));
    const device = String(args.device || ''), phone = paired().find(a => a.id === device);
    if (!phone) throw new Error('找不到已配对手机，请先用 phone_list 查找');
    if (phone.status === 'offline') return result({ online: false, last_seen: phone.lastSeen ?? null, detail: '未向离线手机发送请求；电量、网络和权限未知' });
    const status = await phoneRpc<Record<string, unknown>>(device, 'device.status', {});
    if (!current() || S.agents[device] !== phone) throw new Error('个人助理或手机授权已变化，未返回旧状态');
    return result({ ...status, online: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const detail = message.includes('remote.method_unknown') ? 'remote.method_unknown：手机尚未支持状态查询，电量、网络和权限未知，请检查手机版本' : screenError(e);
    return result(current() ? detail : '个人助理已停止或账号已变化，旧结果未返回', true);
  }
}
