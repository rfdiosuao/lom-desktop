import { S, update } from '@/state/store';
import { phoneRpc } from './phoneRpc';
import { toast } from '@/shared/overlays/controller';
import { audit } from '@/features/settings/runtime/audit';

interface Watch { parent: string; device: string; session: string; checked: number; handled: boolean; }
const key = () => `lom-supervision-v1:${S.account?.id || 'local'}`;
let loaded = '', watches: Watch[] = [], busy = false;
function load() {
  if (loaded === key()) return;
  loaded = key();
  try { const data = JSON.parse(localStorage.getItem(loaded) || '[]'); watches = Array.isArray(data) ? data.filter(x => typeof x.parent === 'string' && typeof x.device === 'string' && typeof x.session === 'string').slice(-100) : []; }
  catch { watches = []; }
}
function save() {
  try { localStorage.setItem(loaded, JSON.stringify(watches.slice(-100))); return true; }
  catch { toast('任务检查记录无法保存，已暂停自动接管；请检查本机存储空间。', 'info'); return false; }
}
export function monitorDelegated(parent: string, device: string, session: string) {
  load(); watches = watches.filter(x => !(x.device === device && x.session === session));
  watches.push({ parent, device, session, checked: Date.now(), handled: false }); save();
}
export function stopMonitoring(parent: string) { load(); watches = watches.filter(x => x.parent !== parent); save(); }

/** Inspects structured task status only. Unknown transport state is never permission to take over. */
export async function tickSupervision(now = Date.now()) {
  if (busy || S.cloud !== 'signed-in' || S.conn !== 'ready' || !Number(S.prefs.supervise)) return;
  load(); const account = S.account?.id, owner = loaded;
  busy = true;
  try {
    for (const item of [...watches]) {
      if (item.handled || now - item.checked < Number(S.prefs.supervise) * 60000) continue;
      const parent = S.convs.find(c => c.remote && c.id === item.parent);
      if (!parent || !S.convPhones[parent.id]?.includes(item.device) || !S.agents[item.device]?.real) { watches = watches.filter(x => x !== item); continue; }
      if (S.agents[item.device].status !== 'online' || S.running[parent.id]) continue;
      item.checked = now;
      try {
        const status = await phoneRpc<{ running: boolean; status: string }>(item.device, 'chat.read', { session_id: item.session, offset: 0 });
        if (account !== S.account?.id || owner !== key() || !watches.includes(item)) return;
        if (status.running) continue;
        if (!['failed', 'timeout', 'interrupted', 'completed', 'cancelled'].includes(status.status)) continue;
        // Persist before notifying/sending; failures are never automatically replayed on restart.
        item.handled = true; const persisted = save();
        audit(parent.id, `monitor:${item.session}`, 'phone_task_check', status.status);
        if (status.status === 'completed' || status.status === 'cancelled') continue;
        update(() => parent.messages.push({ id: crypto.randomUUID(), type: 'system', at: now, text: `${S.agents[item.device].name}的委派任务需要检查（${status.status}），未自动重试。`, ic: 'info' }));
        if (S.prefs.notifyHelp) toast(`${S.agents[item.device].name}的任务需要帮助，请查看总指挥会话。`, 'phone');
        if (!persisted || status.status !== 'failed' || !S.prefs.autoTakeover) continue;
        if (S.convs.some(c => c.owner === item.device && S.running[c.id])) continue;
        const { sendToTask } = await import('@/features/chat/runtime/tasks');
        if (S.running[parent.id] || account !== S.account?.id || !S.prefs.autoTakeover || !S.convPhones[parent.id]?.includes(item.device)) continue;
        const sent = await sendToTask(parent, `手机任务失败辅助检查：设备 ${item.device}，会话 ${item.session}。先调用 phone_task_read、phone_ui_tree 检查实际进度。手机已报告失败并停止。仅在原任务授权范围内处理障碍；不得盲目重跑、不重复发送或发布。处理后交还手机继续原会话；不确定是否已执行的步骤先询问用户。`, []);
        if (!sent && S.prefs.notifyHelp) toast('总指挥辅助检查未启动，请手动打开任务继续。', 'info');
      } catch { /* Preserve unknown. A future read may retry; a task execution never retries here. */ }
    }
    if (owner === key()) save();
  } finally { busy = false; }
}
let timer: ReturnType<typeof setInterval> | undefined;
export function startSupervision() { timer ??= setInterval(() => { void tickSupervision(); }, 5000); }
