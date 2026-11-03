/* D33 依赖跳转：被依赖的任务已经看板上时滚到它并短暂高亮；不在时不假装成功。 */

export function focusTaskCard(taskId: string): boolean {
  if (typeof document === 'undefined') return false;
  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-task-id]'));
  const card = cards.find((el) => el.dataset.taskId === taskId);
  if (!card) return false;
  card.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' });
  card.classList.add('is-flash');
  window.setTimeout(() => card.classList.remove('is-flash'), 1200);
  return true;
}

/** TEAM-FOCUS-01：顶栏选中成员后，把团队页里它的看板列或并排窗格滚到可见处。
 *  没有对应的列 / 窗格时返回 false，由调用方说明原因；减少动态效果（或无法判断）时不做平滑滚动。 */
export function focusMemberView(memberId: string): boolean {
  if (typeof document === 'undefined') return false;
  // 只在团队页里找：其他地方（侧栏、弹窗）同名的 data-member-id 不算这位成员的列 / 窗格
  const page = document.querySelector<HTMLElement>('.team');
  if (!page) return false;
  const views = Array.from(page.querySelectorAll<HTMLElement>('[data-member-id]'));
  const view = views.find((el) => el.dataset.memberId === memberId);
  if (!view) return false;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
  view.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  return true;
}
