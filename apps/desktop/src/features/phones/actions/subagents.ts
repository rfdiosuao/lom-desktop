import { authAccount } from '@/features/account/runtime/authScope';
import type { SubAgentWrite } from '@/core/remoteWire';
import { S } from '@/state/store';
import { closeModal, confirm, openModal, toast, toastError, topModal } from '@/shared/overlays/controller';
import { changePhoneSubagent, phoneSubagents, savePhoneSubagent } from '../runtime/phoneSubagents';

export function editSub(id?: string) {
  const device = S.phoneId, state = phoneSubagents(device);
  if (!S.agents[device]?.real || !state.loaded || state.busy) { toast('请先读取真实手机的子代理列表', 'info'); return; }
  const item = state.items.find(row => row.id === id);
  if (id && !item) { toast('子代理已变化，请刷新列表', 'info'); return; }
  S.form = item ? { ...item } : { id: crypto.randomUUID(), name: '', description: '', instructions: '', model_group: '', enabled: 'true', revision: '', builtin: 'false' };
  openModal('sub', { id, agentId: S.form.id, phoneId: device, current: authAccount(), revision: item?.revision || '' });
}
export async function saveSub() {
  const modal = topModal();
  if (modal?.id !== 'sub') return;
  const device = String(modal.props.phoneId), current = modal.props.current as (() => boolean);
  if (!current?.() || S.phoneId !== device) { toast('账号或所选手机已变化，请重新打开编辑', 'info'); return; }
  const form = S.form, draft = JSON.stringify(form);
  if (form.id !== modal.props.agentId) { toast('编辑草稿已变化，请重新打开子代理', 'info'); return; }
  const input: SubAgentWrite = { id: String(form.id), name: String(form.name).trim(), description: String(form.description), instructions: String(form.instructions), model_group: String(form.model_group), enabled: String(form.enabled), revision: String(modal.props.revision) };
  try {
    await savePhoneSubagent(device, input);
    if (!current() || S.phoneId !== device || topModal() !== modal) return;
    if (S.form === form && JSON.stringify(S.form) === draft) closeModal();
    toast('手机已保存子代理；启用状态影响后续委派', 'check');
  } catch (error) { if (current() && topModal() === modal) toastError('保存失败，草稿已保留', error); }
}
export async function toggleSub(id: string) {
  const device = S.phoneId, current = authAccount();
  const item = phoneSubagents(device).items.find(row => row.id === id);
  if (!item) return;
  try { await changePhoneSubagent(device, 'toggle', { id, enabled: item.enabled === 'true' ? 'false' : 'true', revision: item.revision }); }
  catch (error) { if (current()) toastError('子代理启停失败', error); }
}
export function deleteSub(id: string) {
  const device = S.phoneId, current = authAccount();
  const item = phoneSubagents(device).items.find(row => row.id === id);
  if (!item || item.builtin === 'true') return;
  confirm({ title: `删除子代理「${item.name}」？`, desc: '手机确认后删除配置；不会终止已经运行的任务。', okText: '删除', danger: true, onOk: () => {
    if (!current() || S.phoneId !== device) { toast('账号或所选手机已变化，请重新确认', 'info'); return; }
    void (async () => {
      try { await changePhoneSubagent(device, 'delete', { id, enabled: item.enabled, revision: item.revision }); }
      catch (error) { if (current()) toastError('删除子代理失败', error); }
    })();
  } });
}
