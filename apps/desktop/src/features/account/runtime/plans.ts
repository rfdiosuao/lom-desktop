import { cloud } from './cloud';
import { S, update } from '@/state/store';
import { authAccount, type AuthGuard } from './authScope';

/* ===== 订阅（A03）：四档套餐与我的订阅，全部从麓鸣服务读取 =====
 * 档位是否开售、价格、每日额度、可用模型都以服务端为准；后台改了，这里下次读取就跟着变。 */

export type ModelKey = 'pro' | 'max' | 'mini';
/** 开售的档带全部字段；没开售的只有 tier / name / enabled:false */
export interface Tier {
  tier: number; name: string; enabled: boolean; web_search?: boolean;
  price_month?: number | null; price_quarter?: number | null; price_year?: number | null;
  daily_points?: number; models?: ModelKey[]; max_phones?: number; discount_pct?: number;
}
export interface PlanInfo { tier: number | null; name: string; ends_at: number | null; models: ModelKey[]; max_phones: number; discount_pct: number; daily_points: number }
export interface Plans { tiers: Tier[]; free: PlanInfo; online_payment: boolean }
export interface Subscription { plan: PlanInfo; next_tier: number | null; next_days: number | null }

export const MODEL_NAMES: Record<ModelKey, string> = { pro: 'Lom Pro', max: 'Lom Max', mini: 'Lom Mini' };

let loading: { promise: Promise<void>; isCurrent: AuthGuard } | null = null;

/** 读取套餐与我的订阅；同一时间只发一次 */
export function loadPlans(): Promise<void> {
  if (S.cloud !== 'signed-in') return Promise.resolve();
  if (loading?.isCurrent()) return loading.promise;
  const isCurrent = authAccount();
  const entry = { isCurrent, promise: Promise.resolve() };
  entry.promise = (async () => {
    try {
      const [plans, sub] = await Promise.all([
        cloud<Plans>('GET', '/v1/plans'),
        cloud<Subscription>('GET', '/v1/subscription'),
      ]);
      if (!isCurrent()) return;
      update(s => {
        s.plans = { tiers: [...plans.tiers].sort((a, b) => a.tier - b.tier), free: plans.free, online_payment: plans.online_payment };
        s.subscription = { plan: sub.plan, next_tier: sub.next_tier, next_days: sub.next_days };
        s.plansError = '';
      });
    } catch (e) {
      if (!isCurrent()) return; // Discard the previous account's response, including its errors.
      update(s => { s.plansError = e instanceof Error ? e.message : '读取订阅信息失败'; });
    } finally { if (loading === entry) loading = null; }
  })();
  loading = entry;
  return entry.promise;
}

/** 账号卡片上的一句话：免费版 / 二档 · 2026-11-16 到期 */
export function planLabel(): string {
  const p = S.subscription?.plan;
  if (!p || p.tier == null) return '免费版';
  return p.ends_at ? `${p.name} · ${new Date(p.ends_at * 1000).toLocaleDateString('zh-CN')} 到期` : p.name;
}

/** 分转成元：990 → "9.9" */
export const yuan = (cents: number) => (cents / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
