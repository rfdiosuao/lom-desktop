import { authAccount, authRevision, type AuthGuard } from '@/features/account/runtime/authScope';
import { cloudConfigured } from '@/features/account/runtime/serviceConfig';
import { S } from '@/state/store';

/* ===== REFACTOR-01 模块 2（#280）：每个账号 / 设备一条连接记录 =====
 * 同步、会话轮询、画面和 RPC 原来各自判断「结果还算不算数」，只有同步带代次。现在共用这里的连接代次：
 * 换账号、设备上下线、解绑都会让旧代次失效，迟到的回执不能再写回界面。
 * 同时把「列表显示在线」「RPC 可用」「同步完成」分开记录，不再用在线代替其余两项。 */

export type RpcState = 'unknown' | 'ok' | 'failed';
interface Link { generation: number; online: boolean; rpc: RpcState; rpcAt?: number; rpcError?: string; syncedAt?: number; }

const links = new Map<string, Link>();
let owner: string | undefined;
/** Community builds pair over the LAN while signed out of the cloud. */
export const lanMode = () => !cloudConfigured() && S.cloud !== 'signed-in';
/** LAN devices have no account session; revision still invalidates work on an explicit sign-in attempt. */
export const phoneGuard = (): AuthGuard => lanMode() ? authRevision() : authAccount();

/** 账号变化时整体作废：旧账号的设备记录一条都不保留 */
function scope() {
  const next = S.cloud === 'signed-in' ? S.account?.id : lanMode() ? 'lan' : undefined;
  if (owner !== next) { owner = next; links.clear(); }
  return owner;
}
function link(id: string): Link {
  scope();
  let row = links.get(id);
  if (!row) { row = { generation: 0, online: false, rpc: 'unknown' }; links.set(id, row); }
  return row;
}

/** 观察到的在线状态；上下线切换都开始新代次，旧代次的同步、轮询、画面全部作废 */
export function observeDevice(id: string, online: boolean) {
  const row = link(id);
  if (row.online === online) return false;
  row.online = online; row.generation++;
  if (!online) { row.rpc = 'unknown'; row.rpcError = undefined; }
  return true;
}

/** 主动恢复（唤醒、网络恢复、重新连接）：开始新代次，旧的在途结果不再写回 */
export function restartLink(id: string) { link(id).generation++; }

/** 解绑或从列表移除：记录删除，之前取得的守卫全部失效 */
export function dropLink(id: string) { scope(); links.delete(id); }

/** 取得当前连接的守卫：账号、登录周期、设备记录和代次都没变才算数 */
export function linkGuard(id: string): () => boolean {
  const authenticated = lanMode() ? () => true : authAccount(), account = scope(), row = link(id), generation = row.generation;
  return () => authenticated() && scope() === account && links.get(id) === row && row.generation === generation;
}

/** RPC 传输层结果：手机回了响应（哪怕是业务错误）就是可用；没收到响应才是失败 */
export function recordRpc(id: string, ok: boolean, error?: string) {
  const row = link(id);
  row.rpc = ok ? 'ok' : 'failed'; row.rpcAt = Date.now(); row.rpcError = ok ? undefined : error;
}
export function recordSynced(id: string) { link(id).syncedAt = Date.now(); }

export interface LinkSnapshot { online: boolean; rpc: RpcState; rpcError?: string; syncedAt?: number; generation: number; }
export function linkSnapshot(id: string): LinkSnapshot {
  const row = (scope(), links.get(id));
  return row ? { online: row.online, rpc: row.rpc, rpcError: row.rpcError, syncedAt: row.syncedAt, generation: row.generation } : { online: false, rpc: 'unknown', generation: 0 };
}

export const STALE_LINK = '手机连接已变化（解绑、换账号或重新上线），已丢弃旧结果';
