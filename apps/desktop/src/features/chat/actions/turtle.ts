import { turtleStartPrompt, turtleAnswerPrompt } from '../runtime/turtlePrompt';
import { sendToTask, startDesktopTask, stopTask } from '../runtime/tasks';
import { modelChanges } from '../runtime/taskModel';
import { convOfKey, paneIsDesktop, paneOf, sendToTeam } from '@/features/teams/runtime/team';
import { S, update } from '@/state/store';
import { navigate } from '@/app/navigation';
import { toast } from '@/shared/overlays/controller';

export type { TurtleSession } from '@/state/types';
const pending = new Set<string>();
/** 提问卡对应的会话编号：任务页是会话本身；团队窗格是这个成员的会话（还没开始时用 key 占位） */
export const turtleId = (key: string) => key.startsWith('conv:') ? key.slice(5) : convOfKey(key)?.id ?? key;
export const turtleSending = (key: string) => pending.has(key);
export const turtleBusy = (key: string) => pending.has(key) || !!S.running[turtleId(key)] || modelChanges.has(turtleId(key));


export function enableTurtle(key: string) {
  const c = convOfKey(key);
  const ok = key === 'home' ? S.mode === 'desktop' : paneOf(key) ? paneIsDesktop(key) : !!c?.remote;
  if (!ok) { toast('提问卡目前支持电脑端真实 AI 会话（团队里的手机成员暂不支持）', 'info'); return; }
  if (turtleBusy(key)) { toast('请等当前回复完成后再开启提问卡', 'info'); return; }
  update(s => {
    s.turtles[key] = { active: true, started: false, other: '', showOther: false, request: '', error: '' };
    s.drafts[key] = (s.drafts[key] || '').replace(/^\/海龟汤(?:提问卡)?(?:\s|$)/, '').replace(/^\/[^\s]*$/, '').trim();
    s.menu = null;
  });
}

/** 只使用本轮用户消息之后完成的回答，避免失败时重复展示上一题。 */
export function turtleQuestion(key: string) {
  const c = convOfKey(key);
  const messages = c?.messages || [];
  let lastUser = -1;
  messages.forEach((m, i) => { if (m.type === 'user') lastUser = i; });
  const turn = messages.slice(lastUser + 1);
  const failed = turn.some(m => m.type === 'system' && /失败|已停止|错误/.test(m.text || ''));
  const replies = turn.filter(m => m.type === 'assistant' && !m.streaming && m.text?.trim());
  return { question: !failed && lastUser >= 0 ? replies.at(-1)?.text || '' : '', failed };
}

export async function submitTurtle(key: string, answer?: string) {
  const session = S.turtles[key];
  if (!session?.active || turtleBusy(key)) return;
  const c = convOfKey(key);
  const pane = paneOf(key);
  if (key !== 'home' && !(pane ? paneIsDesktop(key) : c?.remote)) return;
  const topic = (S.drafts[key] || '').trim();
  const text = answer?.trim();
  if (session.started && !text && !session.request) return;
  const request = !session.started ? turtleStartPrompt(topic) : text ? turtleAnswerPrompt(text) : session.request;
  pending.add(key);
  update(() => { session.error = ''; session.request = request; });
  try {
    if (key === 'home') {
      const id = await startDesktopTask(request, [], { title: `海龟汤 · ${topic.slice(0, 18) || '一起梳理想法'}` });
      if (!id) { update(() => { session.error = '未能开始提问，请检查模型配置后重试。'; }); return; }
      update(s => { s.turtles[`conv:${id}`] = { ...session, started: true }; delete s.turtles.home; s.drafts[key] = ''; });
      navigate({ mode: 'desktop', route: { name: 'chat' }, activeConv: id });
    } else {
      // 团队窗格还没开始：交给团队发送（会新建这个成员的会话）
      const ok = pane && !c ? await sendToTeam(pane.t, pane.m, request, []).catch(() => false) : await sendToTask(c!, request, []);
      update(() => {
        if (ok) { session.started = true; session.other = ''; session.showOther = false; S.drafts[key] = ''; }
        else session.error = '发送失败，内容已保留，可以重试。';
      });
    }
  } finally { pending.delete(key); update(); }
}

export async function finishTurtle(key: string) {
  if (pending.has(key)) return;
  if (S.running[turtleId(key)]) await stopTask(turtleId(key));
  if (S.running[turtleId(key)]) return;
  update(s => { if (s.turtles[key]) s.turtles[key].active = false; });
}
