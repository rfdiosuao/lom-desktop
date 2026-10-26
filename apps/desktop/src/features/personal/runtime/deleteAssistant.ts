import { stopFeishuRelay } from './feishuRelay';
import { api, CoreError } from '@/core/client';
import { authAccount } from '@/features/account/runtime/authScope';
import { refreshSchedules, type CoreSchedule } from '@/features/schedules/runtime/schedules';
import { S, update } from '@/state/store';
import { accountId, loadAssistants, removeAssistant, type PersonalAssistant } from './catalog';
import { unbindFeishuAssistant } from './feishuBinding';

/* ===== PA-DELETE：删除个人助理 =====
 * 先停掉它的定时任务，再把它的会话归档（可在「归档的任务」里找回），停止飞书监听并保留恢复归属，最后从助理列表移除。
 * 助理文档目录留在本机不删。任何一步失败都停在那里，不会出现“列表里没了、任务还在跑”。 */
export async function deleteAssistant(a: PersonalAssistant) {
  const owner = accountId(), current = authAccount();
  const saved = loadAssistants(owner).items.find(x => x.id === a.id);
  if (!saved) throw new Error('这位助理已经不在了');
  const conversation = saved.conversation;
  if (conversation && S.running[conversation]) throw new Error('助理还在执行，先停止再删除');
  if (conversation) {
    const rows = await api<CoreSchedule[]>('GET', '/api/cron/jobs');
    for (const row of rows.filter(r => r.metadata.conversation_id === conversation)) {
      if (!current()) throw new Error('账号已切换，未继续删除');
      await api('DELETE', `/api/cron/jobs/${row.id}`);
    }
    if (!current()) throw new Error('账号已切换，未继续删除');
    try { await api('POST', `/api/sidebar/conversation/${encodeURIComponent(conversation)}/archive`); }
    catch (e) { if (!(e instanceof CoreError && e.status === 404)) throw e; } // 会话已不存在也可以继续删除
  }
  if (!current()) throw new Error('账号已切换，未继续删除');
  await stopFeishuRelay(owner, saved.id);
  unbindFeishuAssistant(owner, saved.id);
  localStorage.removeItem(`lom.personal.heartbeats.v1:${owner}:${saved.id}`);
  removeAssistant(saved.id, owner);
  update(s => { if (conversation) s.convs = s.convs.filter(c => c.id !== conversation); });
  await refreshSchedules(current).catch(e => console.warn('personal.delete_schedules_refresh_failed', e));
}
