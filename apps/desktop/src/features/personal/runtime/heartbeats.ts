import { authAccount } from '@/features/account/runtime/authScope';
import { api, CoreError } from '@/core/client';
import { saveCoreSchedule, type CoreSchedule } from '@/features/schedules/runtime/schedules';
import type { PersonalAssistant } from './catalog';
import { personalScheduleDraft, personalScheduleTarget } from './scheduleTarget';
import { S } from '@/state/store';
import { keepInvalid, readJson, writeJson } from '@/features/account/runtime/localCache';
const defaults = [
  { id: 'daily', name: '每日复盘与学习', cron: '0 22 * * *', task: '回顾今天这位助理的真实办事记录和用户纠正，提炼有证据的经验、未完成事项与明日目标。' },
  { id: 'weekly', name: '每周整理与复盘', cron: '0 3 * * SUN', task: '整理本周日记与已有任务结果，归纳重复错误、用户偏好和可复用工作方法，生成周报。只读取已授权且真实可访问的资料。' },
  { id: 'monthly', name: '月度进化评估', cron: '0 9 1 * *', task: '根据本月真实记录评估改进和反复错误，标记可能过期或矛盾的经验并制定下月目标；不要自动删除知识、升级依赖或改动授权。' },
];
const flights = new Map<string, Promise<void>>();
export function ensureHeartbeats(a: PersonalAssistant, rebuildMissing = false): Promise<void> {
  const current = authAccount(), owner = S.account?.id;
  if (!current() || !owner) return Promise.reject(new Error('请先登录账号'));
  const key = `lom.personal.heartbeats.v1:${owner}:${a.id}`;
  const existing = flights.get(key); if (existing) return existing;
  const request = install(a, key, current, rebuildMissing).finally(() => { if (flights.get(key) === request) flights.delete(key); });
  flights.set(key, request); return request;
}
async function install(a: PersonalAssistant, key: string, current: () => boolean, rebuildMissing: boolean) {
  const { conversationId } = personalScheduleTarget(a);
  // REFACTOR-01 模块 7：记录损坏时另存原文，把服务器上没找到的默认任务都当作「待核对」，只能经用户确认后重建，避免重复创建
  const read = readJson(key, v => (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(x => typeof x === 'string') ? v as Record<string, string> : undefined));
  if (read.status === 'unavailable') throw new Error('本机存储不可用，默认任务记录待核对，未创建；请检查存储权限后重试');
  if (read.status === 'invalid') keepInvalid(key, read.raw);
  const states: Record<string, string> = read.status === 'ok' ? read.value : read.status === 'invalid' ? Object.fromEntries(defaults.map(t => [t.id, 'pending'])) : {};
  const save = () => { const result = writeJson(key, states); if (result !== 'ok') console.warn('personal.heartbeat_state_unsaved', result); };
  if (defaults.every(t => states[t.id] === 'done')) return;
  const rows = await api<CoreSchedule[]>('GET', '/api/cron/jobs');
  for (const template of defaults) {
    if (!current()) throw new Error('账号已切换，未继续创建默认任务');
    const marker = `lom:personal-heartbeat:v1:${a.id}:${template.id}`;
    if (rows.some(r => r.description === marker && r.metadata.conversation_id === conversationId)) states[template.id] = 'done';
    if (states[template.id] === 'done') { save(); continue; }
    if (states[template.id] === 'pending' && !rebuildMissing) throw new Error('默认任务创建结果待核对，未重复创建；请同步后重试');
    const prompt = `${template.task}\n先按需读取本助理目录中的 SOUL.md、USER.md、TOOLS.md、AGENTS.md、MEMORY.md 和相关日记；没有真实资料就报告缺口，不编造评分、课程、历史成就或成功次数。经验仅作用于本助理；保留人格正文和安全规则，修改需保留来源与可回滚版本。现有程序尚未提供版本写入能力时，只生成待处理记录，不声称已学习。\n默认静默：结果只留在本助理会话，不发送微信、飞书、邮件或其他对外通知。不得修改任何推送开关。需要权限确认时等待用户，不能以心跳任务绕过。`;
    const draft = personalScheduleDraft(a, { name: template.name, prompt }, { freq: 'custom', time: '', cron: template.cron, scheduleDescription: marker });
    try { await saveCoreSchedule(draft, undefined, { personalId: a.id, beforeCreate: () => {
      if (!current()) throw new Error('账号已切换，未创建默认任务');
      states[template.id] = 'pending'; save();
    } }); } catch (e) {
      if (current() && e instanceof CoreError && e.status && e.status >= 400 && e.status < 500) { delete states[template.id]; save(); }
      throw e;
    }
    if (!current()) throw new Error('账号已切换，默认任务创建结果待核对');
    states[template.id] = 'done'; save();
  }
}
