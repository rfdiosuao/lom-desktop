import { resolveLomId } from '@/features/account/runtime/modelBinding';
import { LOM_PROVIDER_NAME } from '@/features/account/runtime/builtin';
import { S } from './store';
import type { Agent, Conv, ModelOption, Schedule } from './types';

/* ===== 读取器：从状态树派生数据，不修改状态 ===== */

export const PERMISSIONS = [
  { id: 'ask', name: '每次询问', desc: '执行命令、修改文件前都先问你', ic: 'shield', coreMode: 'default' },
  { id: 'edits', name: '自动编辑文件', desc: '文件读写自动进行，执行命令前询问', ic: 'edit', coreMode: 'auto_edit' },
  { id: 'auto', name: '全自动', desc: '在所选文件夹内自动完成所有操作', ic: 'bolt', coreMode: 'yolo' },
  { id: 'full', name: '完全访问', desc: '直接执行已授权任务，不再逐项询问 Lom 操作权限', ic: 'bolt', coreMode: 'yolo' },
  { id: 'readonly', name: '只读规划', desc: '只阅读和给出方案，不做任何修改', ic: 'eye', coreMode: 'default' },
] as const;

export const SKILL_CATS = [
  { value: 'all', label: '全部' }, { value: 'create', label: '内容创作' }, { value: 'publish', label: '发布分发' },
  { value: 'growth', label: '获客互动' }, { value: 'data', label: '数据采集' }, { value: 'office', label: '效率办公' },
];

export const agent = (id: string): Agent | undefined => S.agents[id];
export const phones = (): Agent[] => S.phoneOrder.map(id => S.agents[id]).filter(Boolean);
export const phone = (): Agent => S.agents[S.phoneId] ?? phones()[0];
export const perm = (id: string) => PERMISSIONS.find(p => p.id === id) ?? PERMISSIONS[0];
export const nativeFullAccess = (c: Conv) => S.permission === 'full' && c.owner === 'pc' && c.remote && S.convs.includes(c) && !c.agentId && !c.personal && !c.sideOf;
export const skill = (id: string) => S.skills.find(s => s.id === id);
export const normalizeConvId = (id: string) => id.replace(/^conv:/, '');
export const conv = (id?: string | null) => S.convs.find(c => c.id === id);
export const convsOf = (owner: string) => S.convs.filter(c => c.owner === owner).sort((a, b) => b.updated - a.updated);
export const team = (id?: string) => S.teams.find(t => t.id === id);
/** 这个会话属于哪个跑在内核团队模式上的 OPC 团队（Leader 或本机 Agent 成员） */
export const coreTeamOf = (convId?: string) => (convId ? S.teams.find(t => t.core && (t.leaderConv === convId || Object.values(t.memberConvs || {}).includes(convId))) : undefined);
export const personaOf = (a: Agent) => (a.kind === 'phone' ? a.real ? (a.soulConfigured === undefined ? '人格待同步' : a.soulConfigured ? '已配置人格' : '未配置人格') : a.persona || '未配置人格' : a.persona);

const LOM_TIERS = [
  { tier: 'pro', name: 'Lom Pro', desc: '总指挥默认 · 推理与创作' },
  { tier: 'max', name: 'Lom Max', desc: '最强 · 适合复杂长任务' },
  { tier: 'mini', name: 'Lom Mini', desc: '手机默认 · 快速省额度' },
] as const;

/** 电脑主控可用的模型：Lom 云端三档（登录后用积分） + 自带 Key 的模型服务 */
export const pcModels = (): ModelOption[] => {
  const cloud = S.cloud === 'signed-in' && S.account && S.providers.find(p => p.name === LOM_PROVIDER_NAME && p.enabled);
  const tiers: ModelOption[] = LOM_TIERS.map(t => {
    const model = S.cloudModels?.[t.tier];
    return cloud && model && (!S.cloudAllowed || S.cloudAllowed.includes(t.tier))
      ? { id: `${cloud.id}::${model}`, name: t.name, desc: t.desc, cost: '按积分扣费', providerId: cloud.id, model, lomTier: t.tier }
      : { id: `lom-${t.tier}`, name: t.name, desc: t.desc, cost: S.cloud === 'signed-in' ? S.cloudAllowed && !S.cloudAllowed.includes(t.tier) ? '当前订阅不包含此模型' : '内置模型连接待恢复' : '登录 HEANG 账号后可用', unavailable: true };
  });
  // 订阅里另外勾选的星钥模型：和三档一样走 Lom 云端、按积分扣
  const extra: ModelOption[] = cloud ? S.cloudExtra.map(model => ({ id: `${cloud.id}::${model}`, name: model, desc: '订阅包含的模型', cost: '按积分扣费', providerId: cloud.id, model })) : [];
  const own = S.providers.filter(p => p.enabled && p.name !== LOM_PROVIDER_NAME).flatMap(p => p.models.map(m => ({
    id: `${p.id}::${m}`, name: m, desc: p.name, cost: '自带 Key · 按你的账户计费', byok: true, providerId: p.id, model: m,
  })));
  return [...tiers, ...extra, ...own];
};

/** 手机 Agent 可选的模型：和电脑同一份（Lom 云端三档 + 自带 Key），发任务时同步到手机。
 *  示例手机仍显示示例模型。 */
export const phoneModels = (): ModelOption[] => pcModels();

/** 手机选的模型解析成真实选项：`lom-pro` / `lom-max` / `lom-mini` 这类档位名对应到登录后的云端模型 */
export function phoneModelChoice(id?: string): ModelOption | undefined { return modelChoice(id || ''); }
/** 手机侧保存的模型标识转成展示名：内置档位用档位名，自带 Key 的模型用模型名。 */
export function phoneModelLabel(raw: string): string {
  const tier = /^lom-(pro|max|mini)$/.exec(raw)?.[1];
  return LOM_TIERS.find(t => t.tier === tier)?.name ?? (raw.includes('::') ? raw.slice(raw.indexOf('::') + 2) : raw);
}

/** 手机选择的模型名；失效时仍显示原名，由发送流程给出可操作的错误提示。 */
export function phoneModelName(id?: string): string {
  const raw = (id || '').trim();
  if (!raw) return '选择模型';
  return phoneModelChoice(raw)?.name ?? phoneModelLabel(raw);
}

export function resolvedModelId(id: string, tier?: 'pro' | 'max' | 'mini') {
  const p = S.providers.find(x => x.name === LOM_PROVIDER_NAME && x.enabled);
  return p && S.cloudModels ? resolveLomId(id, p.id, S.cloudModels, S.cloudLegacy, tier, S.cloudExtra) : id;
}
export function modelChoice(id: string, tier?: 'pro' | 'max' | 'mini'): ModelOption | undefined {
  const logical = tier || /^lom-(pro|max|mini)$/.exec(id)?.[1];
  return logical ? pcModels().find(m => m.lomTier === logical || m.id === `lom-${logical}`) : pcModels().find(m => m.id === resolvedModelId(id));
}
export const model = (id: string): ModelOption | undefined => modelChoice(id);
export const currentPcModel = (): ModelOption | undefined => {
  const all = pcModels().filter(m => !m.unavailable);
  const c = S.route.name === 'chat' ? conv(S.activeConv) : undefined;
  if (c?.remote && !c.modelId) return undefined;
  const selected = c?.remote ? c.modelId : S.model;
  const choice = selected ? modelChoice(selected, c?.lomTier) : all[0];
  return choice?.unavailable ? undefined : choice;
};
export const modelName = (id: string) => model(id)?.name ?? '选择模型';

/** 当前积分；未登录时为 null */
export const quotaLeft = () => S.points?.total ?? null;

/* 任务里「添加的手机」= 这个任务可以查看和操作的手机。
 * 首页（新任务）用 lit；已有电脑任务用 convPhones；手机对话里当前手机固定在内。 */
export const attached = (key?: string): string[] => {
  if (!key || key === 'home') {
    return S.mode === 'phone'
      ? [S.phoneId, ...S.homeExtra.filter(id => id !== S.phoneId && S.agents[id])]
      : S.phoneOrder.filter(id => S.lit[id]);
  }
  if (key.startsWith('conv:')) {
    const c = conv(key.slice(5));
    if (!c) return [];
    const extra = (c.remote ? S.convPhones[c.id] : c.phones) ?? [];
    const valid = extra.filter(id => S.agents[id]);
    return c.owner === 'pc' ? valid : [c.owner, ...valid.filter(id => id !== c.owner)];
  }
  return [];
};

export const freqText = (s: Schedule) => {
  if (s.freq === 'custom') return `${s.scheduleDescription || s.cron || '自定义时间'}${s.timezone ? ` · ${s.timezone}` : ''}`;
  const every = Number(s.every);
  /* 任务的时区和本机不同时标出来，避免把北京时间 9 点看成本地 9 点 */
  const tz = s.timezone && s.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone ? ` · ${s.timezone}` : '';
  if (s.freq === 'daily') return `每天 ${s.time}${tz}`;
  if (s.freq === 'weekly') return `每周${s.days.map(d => '日一二三四五六'[d]).join('、')} ${s.time}${tz}`;
  if (s.freq === 'interval') return `每 ${every >= 60 && every % 60 === 0 ? `${every / 60} 小时` : `${every} 分钟`}`;
  return s.time || '一次';
};

export const installedOn = (id: string) => Object.entries(S.installed).filter(([, ids]) => ids.includes(id)).map(([a]) => a);
