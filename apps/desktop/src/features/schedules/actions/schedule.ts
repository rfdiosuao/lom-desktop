import { savePhoneSchedule, changePhoneSchedule, phoneScheduleResult } from '@/features/phones/runtime/phoneSchedules';
import { DEFAULT_RUN_MODE, deleteCoreSchedule, runCoreSchedule, scheduleResult, saveCoreSchedule, toggleCoreSchedule } from '../runtime/schedules';
import { navigate } from '@/app/navigation';
import { toastError } from '@/shared/overlays/controller';
import { unavailable } from '@/shared/lib/unavailable';
import { S, update } from '@/state/store';
import type { Schedule } from '@/state/types';
import { uid } from '@/shared/lib/util';
import { closeModal, confirm, openModal, toast, topModal } from '@/shared/overlays/controller';

/* ===== 电脑定时任务接入核心；手机任务仍为演示 ===== */

const find = (id: string) => S.schedules.find(y => y.id === id);

export async function toggleSched(id: string) {
  const x = find(id);
  if (!x) return;
  if (x.phoneTask) { try { await changePhoneSchedule(x, 'schedule.toggle'); toast('手机已确认更改', 'clock'); } catch (e) { toastError('更改手机任务失败', e); } return; }
  if (x.remote) {
    try { await toggleCoreSchedule(x); toast(x.enabled ? '已暂停' : '已启用', 'clock'); } catch (e) { toastError('更改定时任务失败', e); }
    return;
  }
  update(() => { x.enabled = !x.enabled; });
  toast('已更新本机演示开关，不会改变手机的真实任务', 'info');
}

export async function runSched(id: string) {
  const x = find(id);
  if (!x) return;
  if (x.phoneTask) { try { await changePhoneSchedule(x, 'schedule.run'); toast('手机已接受运行，结果请查看执行记录', 'play'); } catch (e) { toastError('运行手机任务未确认', e); } return; }
  if (x.remote) {
    try { await runCoreSchedule(id); toast('已提交运行，结果以实际执行记录为准', 'play'); } catch (e) { toastError('运行定时任务失败', e); }
    return;
  }
  unavailable('手机定时任务执行');
}

export function editSched(d: { id?: string; exec?: string; prompt?: string }) {
  const x = d.id ? find(d.id) : undefined;
  S.form = x
    ? { ...JSON.parse(JSON.stringify(x)), every: String(x.every) }
    : { name: '', exec: d.exec || 'pc', prompt: d.prompt || '', freq: 'daily', time: '09:00', days: [1], every: '60', runIn: 'new', enabled: true, runMode: DEFAULT_RUN_MODE };
  openModal('sched', { id: x?.id });
}

export async function saveSched() {
  const f = S.form as Schedule;
  const id = topModal()?.props.id as string | undefined;
  if (f.exec === 'pc' || f.remote || S.agents[f.exec]?.real) {
    if (S.form.saving) return;
    update(s => { s.form.saving = true; s.form.error = ''; });
    try { if (S.agents[f.exec]?.real) await savePhoneSchedule(f); else await saveCoreSchedule(f, id); closeModal(); toast(S.agents[f.exec]?.real ? '手机已保存定时任务' : '定时任务已保存到核心服务', 'clock'); }
    catch (e) { update(s => { s.form.error = e instanceof Error ? e.message : String(e); }); }
    finally { update(s => { s.form.saving = false; }); }
    return;
  }
  update(s => {
    const every = Number(f.every) || 60;
    if (id) { const x = find(id); if (x) Object.assign(x, { ...f, every }); }
    else s.schedules.unshift({ ...f, every, id: uid('sc'), last: null, runs: [] });
  });
  closeModal();
  toast('已更新当前界面的手机演示任务，关闭应用后不保留；未实际执行', 'info');
}

export function deleteSched(id: string) {
  const x = find(id);
  if (!x) return;
  confirm({
    title: `删除「${x.name}」？`, okText: '删除', danger: true,
    onOk: async () => {
      if (x.phoneTask) { try { await changePhoneSchedule(x, 'schedule.delete'); closeModal(); toast('手机已删除任务', 'trash'); } catch (e) { toastError('删除失败', e); } return; }
      if (x.remote) { try { await deleteCoreSchedule(id); closeModal(); toast('已删除', 'trash'); } catch (e) { toastError('删除定时任务失败', e); } return; }
      update(s => { s.schedules = s.schedules.filter(y => y.id !== id); s.modals = s.modals.filter(m => m.id !== 'sched'); }); toast('已删除', 'trash'); },
  });
}

export function dupSched(id: string) {
  const x = find(id);
  if (!x) return;
  if (x.remote || x.phoneTask) { editSched({ id }); S.form.name = `${x.name}（副本）`; S.form.enabled = false; delete S.form.phoneTask; delete S.form.revision; const modal = topModal(); if (modal) delete modal.props.id; update(); return; }
  update(s => {
    s.schedules.splice(s.schedules.indexOf(x) + 1, 0, { ...JSON.parse(JSON.stringify(x)), id: uid('sc'), name: `${x.name}（副本）`, enabled: false, auto: false, runs: [], last: null });
  });
  toast('已复制，副本默认暂停', 'copy');
}

export async function openSchedResult(id: string, index = 0) {
  const x = find(id);
  if (x?.phoneTask) {
    try { const id = await phoneScheduleResult(x, index); if (!id) { toast('还没有执行会话', 'info'); return; } closeModal(); navigate({ route: { name: 'chat' }, activeConv: id, mode: 'phone', phoneId: x.exec }); }
    catch (e) { toastError('读取手机运行结果失败', e); } return;
  }
  if (!x?.remote) { toast('手机运行记录暂为演示', 'info'); return; }
  try {
    const conversation = await scheduleResult(id);
    if (!conversation) { toast('暂时还没有执行会话', 'info'); return; }
    closeModal(); navigate({ route: { name: 'chat' }, activeConv: conversation, mode: 'desktop' });
  } catch (e) { toastError('读取运行结果失败', e); }
}

export const schedRuns = (id: string) => openModal('schedRuns', { id });

export const formSet = (name: string, value: unknown) => update(s => { s.form[name] = value; });
export const formDay = (day: number) => update(s => {
  const a: number[] = (s.form.days ||= []);
  const i = a.indexOf(day);
  if (i >= 0) a.splice(i, 1); else a.push(day);
});
export const formToggle = (name: string) => update(s => { s.form[name] = !(s.form[name] ?? true); });
