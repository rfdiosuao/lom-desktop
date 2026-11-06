import { S, update } from '@/state/store';
import { toast } from '@/shared/overlays/controller';

/* ===== PHONE-CAPS-01：手机能做什么，只在这里判断 =====
 * 来源有两个：配对 / 连上时读到的 `device.capabilities` 清单，和运行中某个方法回了 `remote.method_unknown`。
 * 老手机（不实现该方法）没有清单，按「全部支持」处理，保持原来的入口。结果按「设备 ID + 手机应用版本」缓存，
 * 应用版本变了就清空。界面不再各写一份「版本不支持」的判断，一律问这里。 */

export type PhoneFeature = 'skills' | 'subagents' | 'scheduleEdit' | 'documentEdit' | 'attachments' | 'screen';
export type PhoneEntry = 'schedule' | 'skills' | 'subagents' | 'soul' | 'memory';

/** 一项功能需要的方法；其中任何一个可用就算这项功能还在 */
const FEATURE_METHODS: Record<PhoneFeature, readonly string[]> = {
  skills: ['skills.list', 'skills.read', 'skills.install', 'skills.toggle', 'skills.delete'],
  subagents: ['subagent.list', 'subagent.save', 'subagent.toggle', 'subagent.delete'],
  scheduleEdit: ['schedule.save', 'schedule.toggle', 'schedule.delete', 'schedule.run'],
  documentEdit: ['document.write'],
  attachments: ['chat.file', 'chat.image'],
  screen: ['screen.capture', 'screen.tree', 'screen.control'],
};
const UNSUPPORTED: Record<PhoneFeature, string> = {
  skills: '这台手机的应用暂不支持技能',
  subagents: '这台手机的应用暂不支持子代理',
  scheduleEdit: '这台手机的应用暂不支持编辑定时任务',
  documentEdit: '这台手机的应用暂不支持编辑',
  attachments: '这台手机的应用暂不支持发送附件',
  screen: '这台手机的应用暂不支持查看屏幕',
};
export const unsupportedText = (feature: PhoneFeature) => UNSUPPORTED[feature];
export const SCREEN_PERMISSION_TEXT = '请在手机上授权屏幕查看/操作，再重试。';
export const CAPABILITIES_METHOD = 'device.capabilities';

interface Entry {
  version: string;
  /** 手机声明实现的方法；没有 = 老手机 / 尚未读到，按全部支持 */
  methods?: Set<string>;
  limits: Record<string, number>;
  /** 运行中回过 remote.method_unknown 的方法 */
  unsupported: Set<string>;
  /** 已经提示过的功能（每台设备每个应用版本只提示一次） */
  notified: Set<string>;
  /** 已经问过（有清单，或确认是老手机） */
  settled: boolean;
  loading: boolean;
  retryAt: number;
}
const KEY = 'lom.phone.capabilities.v1';
const entries = new Map<string, Entry>();
let owner: string | undefined, restored = false;

interface Saved { v: string; m?: string[]; lim: Record<string, number>; un: string[]; ok: boolean }

function persist() {
  try {
    const out: Record<string, Saved> = {};
    for (const [id, e] of entries) out[id] = { v: e.version, m: e.methods && [...e.methods], lim: e.limits, un: [...e.unsupported], ok: e.settled };
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch (error) { console.warn('手机能力缓存没有保存，下次启动会重新读取', error); }
}
function restore() {
  if (restored) return;
  restored = true;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, Saved>;
    for (const [id, v] of Object.entries(raw)) {
      if (!v || typeof v.v !== 'string') continue;
      entries.set(id, { ...blank(v.v), methods: Array.isArray(v.m) ? new Set(v.m.filter(x => typeof x === 'string')) : undefined,
        limits: numbers(v.lim), unsupported: new Set(Array.isArray(v.un) ? v.un.filter(x => typeof x === 'string') : []), settled: v.ok === true });
    }
  } catch (error) { console.warn('手机能力缓存无法读取，已忽略', error); }
}
const blank = (version: string): Entry => ({ version, limits: {}, unsupported: new Set(), notified: new Set(), settled: false, loading: false, retryAt: 0 });
function numbers(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) if (typeof v === 'number' && Number.isInteger(v) && v >= 0) out[k] = v;
  return out;
}
/** 换账号：旧账号的设备记录一条都不留 */
function scope() {
  const next = S.cloud === 'signed-in' ? S.account?.id : undefined;
  if (owner !== next) { owner = next; entries.clear(); restored = false; }
  restore();
}
const entry = (id: string) => { scope(); return entries.get(id); };
/** 写入用：还没拿到应用版本也先记下（版本一旦确定且不同，会整条清空） */
const writable = (id: string) => { scope(); let e = entries.get(id); if (!e) { e = blank(''); entries.set(id, e); } return e; };
const methodsOf = (feature: PhoneFeature) => FEATURE_METHODS[feature];

/** 手机应用版本：和缓存里的不一致（升级、换了应用）就整条清空重来 */
export function setPhoneAppVersion(id: string, version: string) {
  scope();
  const old = entries.get(id);
  if (old && old.version === version) return;
  entries.set(id, blank(version));
  persist();
}
export function dropPhoneCapabilities(id: string) { scope(); if (entries.delete(id)) persist(); }

/** 这台手机能不能调用这个方法；没有任何信息时按能（老手机） */
export function phoneSupports(id: string, method: string): boolean {
  const e = entry(id);
  if (!e) return true;
  if (e.unsupported.has(method)) return false;
  return !e.methods || e.methods.has(method);
}
/** 一项功能还在不在：它需要的方法至少有一个可用 */
export const phoneFeature = (id: string, feature: PhoneFeature) => methodsOf(feature).some(m => phoneSupports(id, m));

/** 手机页面侧栏的入口。只读部分有内容时保留（只读视图），空的就不放一个点不动的入口 */
export function phoneEntryVisible(id: string, name: PhoneEntry): boolean {
  switch (name) {
    case 'skills': return phoneFeature(id, 'skills');
    case 'subagents': return phoneFeature(id, 'subagents');
    case 'schedule': return phoneFeature(id, 'scheduleEdit') || phoneSupports(id, 'schedule.list') && S.schedules.some(x => x.exec === id);
    case 'soul': return phoneFeature(id, 'documentEdit') || !!(S.souls[id] || '').trim();
    case 'memory': return phoneFeature(id, 'documentEdit') || !!S.memories[id]?.length;
  }
}
/** 手机声明的数值上限（如 chat.send.max_text_chars）；没声明 = 不限制 */
export const phoneLimit = (id: string, key: string): number | undefined => entry(id)?.limits[key];

/** 运行中某个方法回了 remote.method_unknown：记下来，之后按规则隐藏或置灰，并只提示一次 */
export function recordUnsupported(id: string, method: string) {
  if (method === CAPABILITIES_METHOD) return;
  const e = writable(id);
  if (e.unsupported.has(method)) return;
  e.unsupported.add(method);
  persist();
  const feature = (Object.keys(FEATURE_METHODS) as PhoneFeature[]).find(f => FEATURE_METHODS[f].includes(method));
  if (feature && !e.notified.has(feature)) { e.notified.add(feature); toast(UNSUPPORTED[feature], 'info'); }
  update();
}

export interface DeviceCapabilities { version: number; methods: string[]; limits?: Record<string, number> }
/** 读到清单；格式不对当作读取失败（由调用方按老手机处理并记录），不猜 */
export function applyCapabilities(id: string, value: DeviceCapabilities) {
  if (!value || typeof value.version !== 'number' || !Array.isArray(value.methods) || !value.methods.every(m => typeof m === 'string'))
    throw new Error('device.capabilities 回复格式无效');
  const e = writable(id);
  e.methods = new Set([...value.methods, CAPABILITIES_METHOD]);
  e.limits = numbers(value.limits);
  e.settled = true;
  persist();
  update();
}
/** 手机明确说不支持该方法（老手机）：按全部支持处理，不再重复询问 */
export function markLegacyPhone(id: string) {
  const e = writable(id);
  e.methods = undefined; e.limits = {}; e.settled = true;
  persist();
}

/** 要不要（再）问一次：还没问到结果、不在途中、且过了重试间隔 */
export const capabilitiesPending = (id: string) => { const e = writable(id); return !e.settled && !e.loading && Date.now() >= e.retryAt; };
export function beginCapabilities(id: string) { writable(id).loading = true; }
export function endCapabilities(id: string, retryInMs = 0) { const e = writable(id); e.loading = false; e.retryAt = Date.now() + retryInMs; }

/** 发给这台手机的消息能不能发：超过手机声明的字数上限、或手机不支持附件就返回原因 */
export function phoneSendBlock(id: string, text: string, attachments: unknown[] = [], extra = 0): string | undefined {
  if (attachments.length && !phoneFeature(id, 'attachments')) return UNSUPPORTED.attachments;
  const max = phoneLimit(id, 'chat.send.max_text_chars');
  const length = text.length + extra;
  if (max !== undefined && length > max) return `消息太长：${length} 字，这台手机一条消息最多 ${max} 字，请删减后再发送`;
  return undefined;
}
