import { cloud } from './cloud';
import { S, update } from '@/state/store';

/* ===== 公告（A04 §2.1）：启动时和每 30 分钟读取一次有效公告 =====
 * 「通知」级在首页顶部横条显示，可关闭；「重要」级第一次出现时弹窗，点「我知道了」后不再弹。
 * 关闭 / 已读记录按账号存在本机。 */

export interface Notice { id: string; title: string; body: string; level: 'info' | 'important'; pinned: boolean; starts_at: number; ends_at: number | null }

const key = () => `lom.notices.seen:${S.account?.id ?? ''}`;
function seen(): string[] {
  try { const v = JSON.parse(localStorage.getItem(key()) || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
/** 记一条公告为已关闭 / 已读；本机存储写失败只影响下次是否再出现 */
export function markNotice(id: string) {
  const ids = [...new Set([...seen(), id])].slice(-200);
  try { localStorage.setItem(key(), JSON.stringify(ids)); } catch { /* 隐私模式：只影响本次之后是否再提示 */ }
  update(s => { s.noticeSeen = ids; });
}

export async function loadNotices() {
  if (S.cloud !== 'signed-in') return;
  try {
    const list = await cloud<Notice[]>('GET', '/v1/announcements');
    update(s => { s.notices = list; s.noticeSeen = seen(); });
  } catch (e) {
    // 公告读不到不影响使用；下一轮再试
    console.warn('notices.load_failed', e instanceof Error ? e.message : e);
  }
}

/** 首页横条要显示的一条：置顶优先，没关闭过的「通知」级 */
export const bannerNotice = () => S.notices.filter(n => n.level === 'info' && !S.noticeSeen.includes(n.id))
  .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.starts_at - a.starts_at)[0];

/** 需要弹窗的一条「重要」公告 */
export const urgentNotice = () => S.notices.find(n => n.level === 'important' && !S.noticeSeen.includes(n.id));
