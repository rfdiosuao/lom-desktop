import { hideHistory, unhideHistory } from '@/state/history';
import { api } from '@/core/client';
import { convFromCore } from './history';
import { pendingSends } from './cancel';
import { setConvOption, effortOption } from '@/features/settings/runtime/agentOptions';
import { S, update } from '@/state/store';
import type { Conv } from '@/state/types';
import { uid } from '@/shared/lib/util';
import type { CoreConversation } from '@/core/types';

/* ===== 输入框 / 命令背后的真实操作：压缩、归档、推理强度、目标 =====
 * 压缩：Lom 自己的引擎（aionrs）内置 /compact，消息正文必须正好是 /compact，前面不能带设置块
 *（aionrs aion-agent/src/engine.rs handle_command）。外部 Agent 只有它自己报了 compact 命令才发。
 * 推理强度：Lom 任务写进会话 extra.reasoning_effort，重启运行时后下一轮生效（lom-core 传给引擎）；
 * 外部 Agent 用它自己的配置项。 */

const idle = (c: Conv) => !S.running[c.id] && !pendingSends.has(c.id);

/* ---------- 压缩上下文 ---------- */
export async function compactTask(c: Conv) {
  if (!c.remote) throw new Error('只有电脑上的任务可以压缩');
  if (!idle(c)) throw new Error('任务还在执行，等这一轮结束再压缩');
  if (c.agentId) {
    // lom-core SlashCommandItem { command, description }（aionui-api-types agent_build_extra.rs）
    const cmds = await api<{ command: string }[]>('GET', `/api/conversations/${c.id}/slash-commands`).catch(() => []);
    if (!cmds.some(x => x.command.replace(/^\//, '') === 'compact')) throw new Error(`${c.agentName || '这个 Agent'} 没有提供压缩上下文的命令`);
  }
  update(s => { s.running[c.id] = true; c.messages.push({ id: uid('m'), type: 'system', at: Date.now(), text: '正在压缩上下文…', ic: 'refresh' }); });
  try {
    const res = await api<{ turn_id?: string }>('POST', `/api/conversations/${c.id}/messages`, { content: '/compact', files: [] });
    if (res?.turn_id) update(() => { c.turnId = res.turn_id; });
  } catch (e) {
    update(s => { delete s.running[c.id]; });
    throw e;
  }
}

/** 引擎压缩后的回复翻成一句中文（实时和历史都用） */
export function compactNotice(text?: string): string | null {
  if (!text) return null;
  if (/^Context is already compact/i.test(text)) return '上下文已经很精简，不需要压缩';
  const m = /^Context compacted[^\n]*?(\d+)\s+messages?\s+summar/i.exec(text);
  if (m) return `已压缩上下文：前面 ${m[1]} 条消息整理成了摘要，后面的对话更省额度`;
  if (/^Context compacted/i.test(text)) return '已压缩上下文';
  return null;
}

/* ---------- 归档 ---------- */
export async function archiveTask(c: Conv) {
  if (!c.remote) throw new Error('只有电脑上的任务可以归档');
  if (!idle(c)) throw new Error('任务还在执行，先停止再归档');
  await api('POST', `/api/sidebar/conversation/${encodeURIComponent(c.id)}/archive`);
  // 从导入历史续聊的任务：归档后原来那条历史也不再回到列表
  hideHistory(c.historyArchiveId);
  update(s => {
    s.convs = s.convs.filter(x => x.id !== c.id);
    if (s.activeConv === c.id) { s.activeConv = ''; s.route = { name: 'home' }; }
  });
}

type SidebarItem = { type: string; conversation?: CoreConversation };
export async function listArchived(): Promise<Conv[]> {
  const r = await api<{ groups: { items: SidebarItem[] }[] }>('GET', '/api/sidebar?archived=1&limit=100');
  const seen = new Set<string>();
  return r.groups.flatMap(g => g.items).filter(i => i.type === 'conversation' && i.conversation)
    .map(i => convFromCore(i.conversation!)).filter(c => !seen.has(c.id) && !!seen.add(c.id));
}

export async function restoreTask(id: string) {
  await api('POST', `/api/sidebar/conversation/${encodeURIComponent(id)}/unarchive`);
  const c = convFromCore(await api<CoreConversation>('GET', `/api/conversations/${encodeURIComponent(id)}`));
  unhideHistory(c.historyArchiveId);
  update(s => { if (!s.convs.some(x => x.id === id)) s.convs.unshift(c); });
  return c;
}

/* ---------- 推理强度 ---------- */
export const EFFORTS: [string, string][] = [['', '默认'], ['low', '低'], ['medium', '中'], ['high', '高']];
export const effortName = (v?: string) => EFFORTS.find(([k]) => k === (v || ''))?.[1] || v || '默认';

/** 外部 Agent 的 confirmation 口径：只有 observed 能说已生效；
 *  command_ack / 缺失 / 未知值只能说已提交、无法确认。 */
export function effortResult(confirmation: string, value: string): { text: string; kind: 'brain' | 'info' } {
  if (confirmation === 'observed') return { text: `推理强度已生效：${effortName(value)}`, kind: 'brain' };
  if (confirmation === 'pending_next_turn' || confirmation === 'next_turn') {
    return { text: `推理强度改为「${effortName(value)}」，下一轮开始生效`, kind: 'brain' };
  }
  return { text: `推理强度已提交，但无法确认是否生效：${effortName(value)}`, kind: 'info' };
}

/** Lom 任务的模型支不支持推理强度：OpenAI 兼容接口支持（aionrs 默认 low/medium/high），Anthropic、Gemini 不支持 */
export function lomSupportsEffort(providerId?: string) {
  const p = S.providers.find(x => x.id === providerId);
  return !!p && p.platform !== 'anthropic' && p.platform !== 'gemini';
}

/** 同一个会话连续改强度：并发会互相覆盖，且第二次重启会撞上核心 409 */
const effortChanges = new Set<string>();

type CoreEffortState = {
  runtime?: { has_task?: boolean; is_processing?: boolean };
  extra?: { reasoning_effort?: string };
};

const readCoreEffortState = (id: string) => api<CoreEffortState>('GET', `/api/conversations/${id}`);
const coreEffort = (s: CoreEffortState) => s.extra?.reasoning_effort || undefined;

/** 运行时操作失败后把核心强度写回旧值；只有回读确认才算回滚成功 */
async function rollbackCoreEffort(id: string, previous?: string): Promise<{ confirmed: boolean; value?: string }> {
  try {
    await api('PATCH', `/api/conversations/${id}`, { extra: { reasoning_effort: previous || null } });
    const state = await readCoreEffortState(id);
    const value = coreEffort(state);
    return { confirmed: value === previous, value };
  } catch { return { confirmed: false }; }
}

/** UI 只能显示核心真实保存的值：能回读就回读，回读失败时保留已写入的新值并明确报未确认 */
async function settleUnconfirmed(c: Conv, fallback: string | undefined) {
  let current = fallback;
  try { current = coreEffort(await readCoreEffortState(c.id)); } catch { /* 保留已写入的新值 */ }
  update(() => { c.effort = current; });
}

export async function setTaskEffort(c: Conv, value: string) {
  if (c.agentId) {
    const opt = effortOption(S.agentOptions[c.id]);
    if (!opt?.options?.length) throw new Error(`${c.agentName || '这个 Agent'} 没有推理强度选项`);
    return setConvOption(c, opt.id, value);
  }
  if (effortChanges.has(c.id)) throw new Error('正在调整这个任务的推理强度，请稍候');
  if (!idle(c)) throw new Error('任务还在执行，等这一轮结束再调整');
  effortChanges.add(c.id);
  const previous = c.effort;
  const desired = value || undefined;
  try {
    // 先读核心运行状态：读不到就不能当成空闲去 restart/ensure，更不能先写后问。
    let before: CoreEffortState;
    try { before = await readCoreEffortState(c.id); }
    catch { throw new Error('读取任务运行状态失败，未更改推理强度'); }
    if (before.runtime?.is_processing) throw new Error('任务正在执行，未更改推理强度');

    await api('PATCH', `/api/conversations/${c.id}`, { extra: { reasoning_effort: value || null } });

    // 竞态：检查与写入之间核心可能已开始这一轮。此时写入已落盘，既不 restart（会打断当前轮），
    // 也不谎称「未更改」：明确按核心已保存的值更新界面，下一轮生效。
    let after: CoreEffortState;
    try { after = await readCoreEffortState(c.id); }
    catch {
      await settleUnconfirmed(c, desired);
      throw new Error('推理强度已提交，但无法回读核心状态，未确认是否生效');
    }
    const saved = after.extra ? coreEffort(after) : desired;
    if (after.extra && saved !== desired) {
      update(() => { c.effort = saved; });
      throw new Error(`核心没有保存新的推理强度，当前为「${effortName(saved)}」`);
    }
    if (after.runtime?.is_processing) {
      update(() => { c.effort = saved; });
      return 'next_turn';
    }

    const kind = after.runtime?.has_task ? 'restart' : 'ensure';
    try {
      await api('POST', `/api/conversations/${c.id}/runtime/${kind}`, {});
    } catch (e) {
      // 保存成功、运行时失败：先尝试写回旧值并回读确认；回滚未确认就按核心真实值显示，绝不假称未修改。
      const rolled = await rollbackCoreEffort(c.id, previous);
      if (!rolled.confirmed) {
        await settleUnconfirmed(c, saved);
        throw new Error('推理强度已保存，但运行时更新失败且回滚未确认，请在任务里重新选择或下一轮核对');
      }
      update(() => { c.effort = rolled.value; });
      throw new Error(`运行时更新失败，核心已恢复原推理强度：${(e as Error)?.message || kind}`);
    }
    update(() => { c.effort = saved; });
    return 'next_turn';
  } finally { effortChanges.delete(c.id); }
}

/* ---------- 目标（/goal） ---------- */
export function setGoal(key: string, text: string) {
  update(s => { s.goals[key] = { text: text.trim(), at: Date.now(), turns: 0 }; });
}
export const clearGoal = (key: string) => update(s => { delete s.goals[key]; });
export const finishGoal = (key: string) => update(s => { const g = s.goals[key]; if (g) { g.done = true; g.doneAt = Date.now(); g.paused = false; g.note = undefined; } });
export const editGoal = (key: string, text: string) => update(s => { const g = s.goals[key]; if (g && text.trim()) g.text = text.trim(); });
export function pauseGoal(key: string, note?: string) {
  update(s => { const g = s.goals[key]; if (g && !g.done && !g.paused) { g.paused = true; g.pausedAt = Date.now(); g.note = note; } });
}
export function resumeGoal(key: string) {
  update(s => {
    const g = s.goals[key];
    if (!g || g.done || !g.paused) return;
    g.pausedMs = (g.pausedMs || 0) + (Date.now() - (g.pausedAt || Date.now()));
    g.paused = false; g.pausedAt = undefined; g.note = undefined; g.turns = 0;
  });
}
/** 目标已经推进了多久（暂停的时间不算） */
export function goalElapsed(g: { at: number; done?: boolean; doneAt?: number; paused?: boolean; pausedAt?: number; pausedMs?: number }, now = Date.now()) {
  const end = g.done ? g.doneAt || now : g.paused ? g.pausedAt || now : now;
  return Math.max(0, end - g.at - (g.pausedMs || 0));
}
export const fmtElapsed = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

/** 自动推进最多连续几轮；到了就暂停，等你点继续 */
export const GOAL_MAX_TURNS = 30;

/** 一轮结束后决定要不要接着推进：返回 true 表示该自动发下一轮 */
export function goalWantsNextTurn(key: string, status: unknown): boolean {
  const g = S.goals[key];
  if (!g || g.done || g.paused) return false;
  if (status !== 'finished') { pauseGoal(key, '这一轮没有正常完成，已暂停'); return false; }
  if ((g.turns || 0) >= GOAL_MAX_TURNS) { pauseGoal(key, `已连续推进 ${GOAL_MAX_TURNS} 轮，先暂停`); return false; }
  update(s => { const x = s.goals[key]; if (x) x.turns = (x.turns || 0) + 1; });
  return true;
}

/** 每条消息前带给 Agent 的目标（隐藏块，历史里不显示）；目标完成后不再带 */
export function goalContext(key: string) {
  const g = S.goals[key];
  if (!g || g.done) return '';
  return `[LOM_GOAL_V1]\n这个任务的目标：${g.text}\n围绕这个目标持续推进：每一步都朝它前进；回复结尾用一两句话说明已完成什么、还差什么。目标真正达成时，先说明完成依据，再在回复最后单独一行写 [LOM_GOAL_DONE:${g.at}]。未完成、举例或引用时不得输出该标记。\n[/LOM_GOAL_V1]\n\n`;
}

/** Only an explicit terminal marker for the current goal can complete it. */
export function checkGoalReached(key: string, text?: string) {
  const g = S.goals[key];
  if (g && !g.done && text?.trim().split('\n').at(-1) === `[LOM_GOAL_DONE:${g.at}]`) finishGoal(key);
}

/** Presentation only: retain the raw reply for goal completion detection. */
export function visibleReply(text = '', streaming = false) {
  const out = text.replace(/(?:^|\n)[ \t]*\[LOM_GOAL_DONE:\d+\][ \t]*(?=\r?$|\r?\n)/gm, '').trimEnd();
  if (!streaming) return out;
  // 流式输出时，最后一行可能是还没写完的完成标记（「[LOM_GOAL_D」「[LOM_GOAL_DONE:17」）：先不显示
  const i = out.lastIndexOf('\n'), last = out.slice(i + 1).trim();
  const partial = last.length > 1 && ('[LOM_GOAL_DONE:'.startsWith(last) || /^\[LOM_GOAL_DONE:\d*\]?$/.test(last));
  return partial ? out.slice(0, Math.max(i, 0)).trimEnd() : out;
}
