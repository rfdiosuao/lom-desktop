import { authAccount } from '@/features/account/runtime/authScope';
import { readJson, writeJson } from '@/features/account/runtime/localCache';
import { S, update } from '@/state/store';
import { linkGuard } from './deviceLink';
import { phoneRpc } from './phoneRpc';
import { phoneSupports } from './phoneCapabilities';
import { checkLogo, type LogoReply } from './phoneLogo';

/* ===== PHONE-PROFILE-02：手机上的应用名和头像（OPEN-PHONE-03 的 device.profile / device.logo） =====
 * 手机报什么就显示什么；没有上报（老手机、官方手机端未升级）就是「未知应用」和通用图标，绝不按型号猜。
 * 头像图片只放内存（本机存储容易写满），应用名和哈希持久化；回复类型待 lom-protocol 生成，先在这里按文档声明。 */

export const PROFILE_METHOD = 'device.profile', LOGO_METHOD = 'device.logo';
interface ProfileReply { app_name?: string; logo_sha256?: string; logo_mime?: string; logo_size?: string }
interface Saved { app: string; sha: string }
/** logoSha：手头这张图的哈希（可能比手机现在声明的旧——取新图失败时沿用旧图） */
interface Entry { app: string; sha: string; logo?: string; logoSha?: string }

const KEY = 'lom.phone.profile.v1:';
const MAX_DEVICES = 32, REFRESH_MS = 60_000, MAX_FAILURES = 3;
const entries = new Map<string, Entry>(), failures = new Map<string, number>(), lastRead = new Map<string, number>(), reading = new Set<string>();
let owner: string | undefined;

/** 去掉控制字符和双向文本控制字符，限长；只当纯文本显示 */
export const cleanText = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, '').trim().slice(0, max) : '';

function scope() {
  const next = S.cloud === 'signed-in' ? S.account?.id : undefined;
  if (owner === next) return;
  owner = next; entries.clear(); failures.clear(); lastRead.clear();
  if (!next) return;
  const read = readJson(KEY + next, v => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, Saved> : undefined);
  if (read.status !== 'ok') return;
  for (const [id, v] of Object.entries(read.value).slice(0, MAX_DEVICES)) if (typeof v?.app === 'string' && typeof v?.sha === 'string') entries.set(id, { app: cleanText(v.app, 40), sha: /^[0-9a-f]{64}$/.test(v.sha) ? v.sha : '' });
}
function persist() {
  if (!owner) return;
  const out: Record<string, Saved> = {};
  for (const [id, e] of [...entries].slice(-MAX_DEVICES)) out[id] = { app: e.app, sha: e.sha };
  if (writeJson(KEY + owner, out) !== 'ok') console.warn('phone.profile_cache_unsaved：手机应用名没有保存，下次启动会重新读取');
}

/** 界面要显示的手机资料：应用名、头像（data: URL），没有就是空 */
export function phoneProfile(id: string): { appName?: string; logo?: string } {
  scope();
  const e = entries.get(id);
  return { appName: e?.app || undefined, logo: e?.logo };
}
export function dropPhoneProfile(id: string) { scope(); if (entries.delete(id)) persist(); lastRead.delete(id); for (const k of [...failures.keys()]) if (k.startsWith(`${id}:`)) failures.delete(k); }

function show(id: string) {
  update(s => { const a = s.agents[id], p = phoneProfile(id); if (a) { a.appName = p.appName; a.logo = p.logo; } });
}

async function fetchLogo(id: string, sha: string, mime: string, size: string, fresh: () => boolean): Promise<string | undefined> {
  const key = `${id}:${sha}`;
  if ((failures.get(key) ?? 0) >= MAX_FAILURES || !phoneSupports(id, LOGO_METHOD)) return undefined;
  try {
    const reply = await phoneRpc<LogoReply>(id, LOGO_METHOD, {});
    if (!fresh()) return undefined;
    if (reply.sha256 !== sha || reply.mime !== mime || reply.size !== size) throw new Error('phone.logo_invalid：头像与 device.profile 声明不一致');
    return await checkLogo(reply, sha);
  } catch (e) {
    failures.set(key, (failures.get(key) ?? 0) + 1);
    console.warn('手机头像没有更新，沿用旧头像', e instanceof Error ? e.message : e);
    return undefined;
  }
}

/** 连上手机和每次完整刷新时调用：一台手机同一时刻只有一次在途，约 60 秒才再读。 */
export async function syncPhoneProfile(id: string) {
  scope();
  if (!S.agents[id]?.real || !phoneSupports(id, PROFILE_METHOD) || reading.has(id) || Date.now() - (lastRead.get(id) ?? 0) < REFRESH_MS) return;
  const account = authAccount(), link = linkGuard(id), fresh = () => account() && link();
  reading.add(id); lastRead.set(id, Date.now());
  try {
    const reply = await phoneRpc<ProfileReply>(id, PROFILE_METHOD, {});
    if (!fresh()) return;
    const app = cleanText(reply.app_name, 40), sha = /^[0-9a-f]{64}$/.test(reply.logo_sha256 ?? '') ? reply.logo_sha256! : '';
    const old = entries.get(id);
    let { logo, logoSha } = old ?? {};
    if (!sha) { logo = undefined; logoSha = undefined; }
    else if (logoSha !== sha) {
      const fetched = await fetchLogo(id, sha, reply.logo_mime ?? '', reply.logo_size ?? '', fresh);
      if (fetched) { logo = fetched; logoSha = sha; }
    }
    if (!fresh()) return;
    entries.delete(id); entries.set(id, { app, sha, logo, logoSha });
    persist(); show(id);
  } catch (e) {
    // 读取失败（超时、手机未就绪）不等于不支持：保留旧资料，下个周期再试；method_unknown 已由 phoneRpc 记入不支持缓存
    if ((e as { code?: string } | null)?.code !== 'remote.method_unknown') console.warn('读取手机应用资料失败，沿用旧资料', e instanceof Error ? e.message : e);
  } finally { reading.delete(id); }
}
