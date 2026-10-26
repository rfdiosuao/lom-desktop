import { useEffect } from 'react';
import { subscribe } from '@/features/settings/actions/settings';
import { Btn } from '@/shared/ui/Button';
import { Badge } from '@/shared/ui/Controls';
import { Section } from '@/shared/ui/Layout';
import { loadPlans, MODEL_NAMES, yuan, type PlanInfo, type Tier } from '../runtime/plans';
import { useStore } from '@/state/store';
import { cx } from '@/shared/lib/util';

/* ===== 设置 → 账号 → 我的订阅：免费 + 四档，内容全部来自麓鸣服务 =====
 * 后台把某一档设为开售，这里下次读取就显示价格与权益；没开售的档显示「未开放」。 */

const models = (keys?: string[]) => (keys?.length ? keys.map(k => MODEL_NAMES[k as keyof typeof MODEL_NAMES] ?? k).join(' · ') : '—');

function FreeCard({ free, current }: { free: PlanInfo; current: boolean }) {
  return (
    <div className={cx('plan', current && 'is-current')}>
      <div className="plan__name">免费{current && <Badge text="当前" tone="brand" />}</div>
      <div className="plan__price">¥0</div>
      <ul className="plan__list">
        <li>每月赠送 300 点积分</li>
        <li>{models(free.models)}</li>
        <li>最多 {free.max_phones} 台手机</li>
        <li>积分按原价扣除</li>
      </ul>
    </div>
  );
}

function TierCard({ t, current }: { t: Tier; current: boolean }) {
  if (!t.enabled) {
    return (
      <div className="plan is-closed" aria-disabled="true">
        <div className="plan__name">{t.name}</div>
        <div className="plan__closed">未开放</div>
        <div className="plan__alt">开放后会在这里显示价格与权益</div>
      </div>
    );
  }
  const alt = [t.price_quarter ? `季付 ¥${yuan(t.price_quarter)}` : '', t.price_year ? `年付 ¥${yuan(t.price_year)}` : ''].filter(Boolean).join(' · ');
  return (
    <div className={cx('plan', current && 'is-current')}>
      <div className="plan__name">{t.name}{current && <Badge text="当前" tone="brand" />}</div>
      <div>
        <div className="plan__price">{t.price_month ? <>¥{yuan(t.price_month)}<small> / 月</small></> : '—'}</div>
        {alt && <div className="plan__alt">{alt}</div>}
      </div>
      <ul className="plan__list">
        <li>每天 {t.daily_points ?? 0} 点额度</li>
        {t.web_search && <li>Lom 联网搜索与网页读取 · 按次消耗额度</li>}
        <li>{models(t.models)}</li>
        <li>最多 {t.max_phones ?? 1} 台手机</li>
        <li>{t.discount_pct && t.discount_pct < 100 ? `积分 ${t.discount_pct / 10} 折` : '积分按原价扣除'}</li>
      </ul>
      {current
        ? <Btn label="续费" variant="secondary" size="sm" onClick={() => subscribe(t.tier)} />
        : <Btn label="开通" variant="primary" size="sm" onClick={() => subscribe(t.tier)} />}
    </div>
  );
}

export function MyPlan() {
  const s = useStore();
  const signedIn = s.cloud === 'signed-in';
  useEffect(() => { if (signedIn) void loadPlans(); }, [signedIn]);
  if (!signedIn) return null;
  const plans = s.plans, sub = s.subscription;
  const tier = sub?.plan.tier ?? null;
  const next = sub?.next_tier ? plans?.tiers.find(t => t.tier === sub.next_tier) : undefined;
  return (
    <Section title="我的订阅" extra={<Btn label="刷新" ic="refresh" variant="ghost" size="sm" onClick={() => void loadPlans()} />}
      hint={next ? `已预约：当前订阅到期后转为${next.name}（${sub?.next_days ?? 0} 天）。` : '价格与权益由麓鸣服务下发，与运营后台同步；订阅兑换码可在「模型与额度 → 充值积分」里兑换。'}>
      {s.plansError && <p className="form-error" style={{ marginBottom: 10 }}>{s.plansError}</p>}
      <div className="plan-wrap"><div className="plan-grid">
        {plans ? <>
          <FreeCard free={plans.free} current={tier == null} />
          {plans.tiers.map(t => <TierCard key={t.tier} t={t} current={tier === t.tier} />)}
        </> : ['免费', '一档', '二档', '三档', '四档'].map(n => (
          <div key={n} className="plan is-closed"><div className="plan__name">{n}</div><div className="plan__closed">{s.plansError ? '暂时无法读取' : '正在读取…'}</div></div>
        ))}
      </div></div>
    </Section>
  );
}
