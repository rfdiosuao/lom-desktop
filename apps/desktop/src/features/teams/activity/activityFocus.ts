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
