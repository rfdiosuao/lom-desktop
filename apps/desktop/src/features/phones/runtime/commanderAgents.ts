import { delegatedTasks } from '@/features/teams/runtime/delegations';
import { captureDelegation, trackDelegation } from '@/features/teams/runtime/delegationLifecycle';
import { agentRow, pinnedAgents, usable, type AgentRow } from '@/features/settings/runtime/agents';
import { isTaskStopping, stopChildTask, stopTask } from '@/features/chat/runtime/cancel';
import { AGENT_PREFIX, recordDelegation, specialty } from '@/features/teams/runtime/team';
import { sendToTask, startDesktopTask } from '@/features/chat/runtime/tasks';
import { S } from '@/state/store';
import { coreTeamOf } from '@/state/selectors';
import { loadHistory } from '@/features/chat/runtime/history';
import { api } from '@/core/client';
import type { Conv, Msg } from '@/state/types';

/* ===== 总指挥派活给本机 Agent（Codex CLI、Kimi、Pi……）=====
 * 团队任务里只能派给团队成员；普通任务里可以派给加到切换器里的 Agent。
 * 派出去的是一个真实的外部 Agent 任务，Leader 用 agent_task_read 读真实结果。 */

type Result = { isError?: boolean; content: { type: 'text'; text: string }[] };
const text = (value: unknown): Result => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });


function allowed(commander: Conv): AgentRow[] {
  const t = commander.teamId ? S.teams.find(x => x.id === commander.teamId) : undefined;
  const ids = t ? t.members.map(m => m.agent).filter(id => id.startsWith(AGENT_PREFIX)).map(id => id.slice(AGENT_PREFIX.length)) : pinnedAgents().map(a => a.id);
  return ids.map(id => agentRow(id)).filter((a): a is AgentRow => !!a);
}

function resolve(commander: Conv, who: unknown) {
  const key = String(who || '').trim().replace(AGENT_PREFIX, '');
  const a = allowed(commander).find(x => x.id === key || x.name === key || x.backend === key.toLowerCase());
  if (!a) throw new Error(`没有可用的成员「${String(who || '')}」；先调用 agent_list 查看`);
  if (!usable(a)) throw new Error(`${a.name} 现在不可用（未安装或连接失败），未派发`);
  return a;
}

/** 派出去的任务：本次运行里记下的，或（重启后）同一团队里本机 Agent 的任务 */
function own(commander: Conv, taskId: unknown) {
  const id = String(taskId || '');
  const c = S.convs.find(x => x.id === id);
  const mine = delegatedTasks(commander.id).some(x => x.id === id);
  if (!mine) throw new Error('这不是当前任务派出去的任务编号');
  if (!c) throw new Error('任务已不存在');
  return c;
}

const line = (m: Msg) => m.type === 'assistant' ? m.text || ''
  : m.type === 'tool' ? `[工具] ${m.tool || ''} · ${m.status || ''}${m.output ? `：${String(m.output).slice(0, 300)}` : ''}`
  : m.type === 'system' ? `[系统] ${m.text || ''}` : '';

export async function executeAgentTool(commander: Conv, name: string, args: Record<string, unknown>): Promise<Result | null> {
  // 内核团队里的本机 Agent 是团队成员：用 team_task_create / team_send_message 协作，不另开任务
  if (name.startsWith('agent_task_') && coreTeamOf(commander.id)) throw new Error('团队成员请用 team_task_create（owner 填 slot_id）或 team_send_message 协作；先用 team_members 查看 slot_id');
  if (name === 'agent_list') {
    return text(allowed(commander).map(a => ({ id: `${AGENT_PREFIX}${a.id}`, name: a.name, specialty: specialty(a), available: usable(a) })));
  }
  if (name === 'agent_task_start') return trackDelegation(commander.id, startDelegated(commander, args));
  if (name === 'agent_task_read') {
    const c = own(commander, args.task_id);
    const info = await api<{ runtime?: { is_processing?: boolean } }>('GET', `/api/conversations/${c.id}`);
    const history = await loadHistory(c);
    const recent = history.messages.slice(-12).map(line).filter(Boolean).join('\n').slice(-6000);
    return text({ task_id: c.id, running: !!info.runtime?.is_processing, output: recent || '（还没有输出）' });
  }
  if (name === 'agent_task_cancel') {
    const c = own(commander, args.task_id);
    const stopped = await stopTask(c.id);
    return text({ status: stopped ? 'cancelled' : 'cancel_unconfirmed', task_id: c.id });
  }
  return null;
}

async function startDelegated(commander: Conv, args: Record<string, unknown>): Promise<Result> {
  if (isTaskStopping(commander.id)) throw new Error('总指挥正在停止，未派发成员任务');
  const current = captureDelegation(commander);
  const task = String(args.text || '').trim();
  if (!task) throw new Error('任务内容不能为空');
  if (args.task_id) {
    const c = own(commander, args.task_id);
    if (S.running[c.id]) throw new Error('这个任务还在执行，等它结束或先取消');
    if (!await sendToTask(c, task, [], current)) throw new Error('成员未接受新消息，请查看会话错误');
    await requireCurrentDelegation(current, c);
    return text({ status: 'accepted', task_id: c.id, message: '已追加。用 agent_task_read 读取真实结果；accepted 不等于完成。' });
  }
  const a = resolve(commander, args.agent);
  const id = await startDesktopTask(task, [], { title: `${a.name} · ${task.slice(0, 14)}`, folder: commander.workspace, team: commander.teamId, parent: commander.id, agent: a, parentCurrent: current });
  if (!id) throw new Error(`${a.name} 任务创建失败`);
  const child = S.convs.find(c => c.id === id);
  if (child) await requireCurrentDelegation(current, child);
  recordDelegation(commander.id, `${AGENT_PREFIX}${a.id}`, id);
  return text({ status: 'accepted', task_id: id, agent: a.name, message: '已派发。用 agent_task_read 读取真实结果；accepted 不等于完成。' });
}

async function requireCurrentDelegation(current: () => boolean, child: Conv) {
  if (current()) return;
  const result = await stopChildTask(child.id);
  throw new Error(result.ok ? '总指挥已停止，成员任务已取消' : '总指挥已停止，但成员任务停止尚未确认，请打开成员会话检查');
}

/** 停止总指挥时，一并停止它派给本机 Agent、仍在执行的任务 */
export async function stopAgentDelegated(commanderId: string) {
  const ids = delegatedTasks(commanderId).filter(c => c.remote).map(c => c.id);
  const results = await Promise.all(ids.map(id => stopChildTask(id)));
  // 只统计真的在跑、被停下来的；本来就空闲的成员不算，也不往它的记录里写「已停止」
  return { stopped: results.filter(r => r.ok && r.ran).length, failed: results.filter(r => !r.ok).length };
}
