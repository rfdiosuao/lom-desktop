import { S } from '@/state/store';
import type { Conv } from '@/state/types';

/* ===== PHONE-POLL-01：手机会话轮询节奏 =====
 * 判断会话是否正显示在屏幕上（决定 0.5 秒起步的快节奏还是 8 秒的离屏节奏），
 * 并让等待下一次读取的轮询可以被提前唤醒。 */

/** 会话正显示在屏幕上：窗口可见，并且任务页打开的就是它，或团队页（并排、单个或看板）正展示它所在团队的成员会话 */
export function phoneOnScreen(c: Conv): boolean {
  if (document.hidden) return false;
  const { route } = S;
  if (route.name === 'chat') return S.activeConv === c.id;
  if (route.name !== 'team' || !route.id) return false;
  const team = S.teams.find(t => t.id === route.id);
  return c.teamId === route.id || Object.values(team?.memberConvs ?? {}).includes(c.id);
}

/** 正在等下一次读取的会话 → 提前结束这次等待 */
const sleepers = new Map<string, () => void>();

/** 窗口回到前台、获得焦点或切换页面后：屏幕上的手机会话立即读一次，不必等完剩下的间隔 */
export function wakeVisiblePhones() {
  for (const [id, wake] of [...sleepers]) {
    const c = S.convs.find(x => x.id === id);
    if (c && phoneOnScreen(c)) wake();
  }
}

const onVisibility = () => { if (!document.hidden) wakeVisiblePhones(); };

/** 只在有轮询等待时挂监听，等待全部结束后移除 */
function listen(on: boolean) {
  if (on) {
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', wakeVisiblePhones);
  } else {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', wakeVisiblePhones);
  }
}

/** 等到下一次读取；到时或被唤醒时结束。同一会话同时只有一个轮询（watchPhone 按会话去重） */
export function pollPause(c: Conv, ms: number): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer);
      if (sleepers.get(c.id) === done) sleepers.delete(c.id);
      if (!sleepers.size) listen(false);
      resolve();
    };
    const timer = setTimeout(done, ms);
    if (!sleepers.size) listen(true);
    sleepers.set(c.id, done);
  });
}
