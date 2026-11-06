import { authAccount } from '@/features/account/runtime/authScope';
import { listMarket, type MarketSkill } from './skillMarket';

const starterSkills = [
  ['viral_titles', '爆款标题生成', '为小红书、抖音、公众号和 B 站生成标题', '写作', 10],
  ['video_script', '短视频口播脚本', '生成口播稿、分镜建议和结尾引导', '运营', 10],
  ['comment_reply', '评论区回复助手', '按账号风格起草评论回复', '运营', 0],
  ['content_calendar', '选题策划与内容日历', '规划主题、发布时间和分工', '运营', 10],
  ['weekly_report', '周报月报整理', '把零散记录整理成周报或月报', '效率', 0],
] as const;

const bundledCatalog: MarketSkill[] = starterSkills.map(([slug, name, summary, category, price]) => ({
  id: `sk_official_${slug}`, name, summary, category, price, official: true, owned: price === 0,
  version: 1, downloads: 0,
}));

const cacheKey = (account: string) => `lom.skill-catalog.v1.${account}`;

export function readSkillCatalog(account?: string): MarketSkill[] {
  if (account) {
    try {
      const rows: unknown = JSON.parse(localStorage.getItem(cacheKey(account)) ?? 'null');
      if (Array.isArray(rows) && rows.every(row => row && typeof row.id === 'string' &&
          typeof row.name === 'string' && typeof row.summary === 'string' && typeof row.category === 'string')) return rows;
    } catch { /* The bundled catalog also works when local storage is unavailable. */ }
  }
  return bundledCatalog;
}

let pending: { account: string; current: () => boolean; result: Promise<MarketSkill[]> } | undefined;

export function refreshSkillCatalog(account: string): Promise<MarketSkill[]> {
  if (pending?.account === account && pending.current()) return pending.result;
  const current = authAccount();
  const request = listMarket().then(rows => {
    if (!Array.isArray(rows)) throw new Error('技能目录暂时无法更新');
    if (current()) {
      try { localStorage.setItem(cacheKey(account), JSON.stringify(rows)); }
      catch { /* Continue using the current in-memory result. */ }
    }
    return rows;
  }).finally(() => {
    if (pending?.result === request) pending = undefined;
  });
  pending = { account, current, result: request };
  return request;
}
