import { phoneDocument, syncPhoneDocuments, writePhoneDocument } from '../runtime/phoneDocuments';
import { dropPhone, removeDevice, renameDevice } from '../runtime/devices';
import { agent, phone } from '@/state/selectors';
import { S, update } from '@/state/store';
import { uid } from '@/shared/lib/util';
import { closeModal, confirm, openModal, prompt, toast, toastError, topModal } from '@/shared/overlays/controller';

import { unavailable } from '@/shared/lib/unavailable';

const isReal = (id?: string) => !!agent(id || S.phoneId)?.real;

/* ===== 手机：子代理、人格、记忆、发送文件、设备与配对 =====
 * 配对与移除使用 R01，人格和记忆使用 R02；PHONE-01 子代理操作以手机确认结果为准。 */

export { editSub, saveSub, toggleSub, deleteSub } from './subagents';

/* ---------- 人格 SOUL.md ---------- */
export async function saveSoul() {
  const p = phone();
  if (p.real) {
    try { await writePhoneDocument(p.id, 'SOUL.md', S.souls[p.id] || ''); toast('手机已保存人格', 'check'); }
    catch (e) { toastError('人格未同步，草稿已保留', e); }
    return;
  }
  update(s => { delete s.soulDirty[p.id]; });
  toast('已更新当前界面的示例人格，关闭应用后不保留；未同步到手机', 'info');
}
export const soulMode = (v: string) => update(s => { s.soulPreview = v === 'split'; });
export function applySoulTpl(name: string, desc: string) {
  const p = phone();
  const apply = () => update(s => {
    s.souls[p.id] = `# ${p.name} · ${name}\n\n## 身份\n- ${desc}\n\n## 说话风格\n- 真实、友好、不夸大\n\n## 负责\n- 账号日常运营与互动\n\n## 底线\n- 涉及价格与合作，先问主人`;
    p.persona = name;
    s.soulDirty[p.id] = true;
  });
  if ((S.souls[p.id] || '').trim()) confirm({ title: '用模板替换当前内容？', desc: '当前 SOUL.md 会被覆盖（保存前可以撤销修改）。', okText: '替换', onOk: apply });
  else apply();
}
export const blankSoul = () => update(s => { const p = phone(); s.souls[p.id] = `# ${p.name}\n\n## 身份\n- \n\n## 说话风格\n- \n\n## 负责\n- `; s.soulDirty[p.id] = true; });

/* ---------- 记忆 ---------- */
export const addMemory = () => { S.form = { text: '' }; openModal('memory', {}); };
export function editMemory(id: string) {
  const m = S.memories[S.phoneId]?.find(x => x.id === id);
  if (!m) return;
  S.form = { text: m.text };
  openModal('memory', { id });
}
export async function saveMemory() {
  const id = topModal()?.props.id as string | undefined;
  if (isReal()) {
    const device = S.phoneId;
    const name = id || 'GLOBAL.md';
    const prior = phoneDocument(device, name);
    try {
      if (!prior) throw new Error('手机记忆还没加载，请稍后再试');
      const text = id ? String(S.form.text) : `${prior.text}\n\n${S.form.text}`.trim();
      await writePhoneDocument(device, name, text); closeModal(); await syncPhoneDocuments(device); toast('手机已保存记忆', 'check');
    } catch (e) { toastError('记忆未同步，编辑内容已保留', e); }
    return;
  }
  update(s => {
    const list = (s.memories[s.phoneId] ||= []);
    if (id) { const m = list.find(x => x.id === id); if (m) m.text = s.form.text; }
    else list.unshift({ id: uid('me'), text: s.form.text, src: '手动', at: Date.now() });
  });
  closeModal();
  toast('已更新当前界面的示例记忆，关闭应用后不保留；未同步到手机', 'info');
}
export const deleteMemory = (id: string) => {
  if (isReal()) { void writePhoneDocument(S.phoneId, id, '').then(() => syncPhoneDocuments(S.phoneId)).catch(e => toastError('手机记忆未删除', e)); return; }
  update(s => { s.memories[s.phoneId] = (s.memories[s.phoneId] || []).filter(x => x.id !== id); }); toast('已删除这条记忆', 'trash');
};
export const clearMemory = () => confirm({ title: `清空${phone().name}的全部记忆？`, desc: '将清空手机上的记忆文件。', okText: '清空', danger: true, onOk: async () => {
  if (isReal()) {
    const device = S.phoneId;
    try { for (const item of S.memories[device] || []) await writePhoneDocument(device, item.id, ''); await syncPhoneDocuments(device); }
    catch (e) { toastError('部分记忆尚未清空', e); }
  } else update(s => { s.memories[s.phoneId] = []; });
} });

/* ---------- 发送文件到手机 ---------- */
export const sendFiles = (phoneId = S.phoneId) => S.agents[phoneId]?.real ? openModal('sendFiles', { phone: phoneId }) : unavailable('向手机传送文件');
export const toggleSendFile = (name: string) => update(s => { const a: string[] = s.form.sel; const i = a.indexOf(name); if (i >= 0) a.splice(i, 1); else a.push(name); });
export const doSendFiles = (_phoneId: string) => unavailable('向手机传送文件');

/* ---------- 设备 ---------- */
export const manageDevice = (id: string) => openModal('device', { id });
export function reconnect(id: string) {
  if (isReal(id)) { toast('请在手机上打开麓鸣 App，它会自动重新连接；在线状态每 15 秒刷新一次。', 'info'); return; }
  toast('这是示例手机，无法建立真实连接。请使用配对新手机。', 'info');
}
export function renamePhone(id: string) {
  const p = agent(id);
  if (!p) return;
  prompt({
    title: '重命名手机', label: '名称', value: p.name,
    onOk: v => {
      if (!p.real) { update(() => { p.name = v || p.name; }); toast('已修改本机示例名称', 'info'); return; }
      void renameDevice(p.id, v).then(synced => { toast(synced ? '手机已保存新名称' : '名称已保存，手机尚未确认；上线后会自动重试同步', synced ? 'check' : 'info'); }, e => toastError('重命名失败', e));
    },
  });
}
export function unpair(id: string) {
  const p = agent(id);
  if (!p) return;
  confirm({
    title: `解除与「${p.name}」的配对？`, desc: '手机会清除连接凭据，回到未配对状态；它的会话、人格、技能和记忆仍保留在手机上。', okText: '解除配对', danger: true,
    onOk: async () => {
      if (p.real) {
        try { await removeDevice(p.id); } catch (e) { toastError('解除配对失败', e); return; }
      }
      update(s => { dropPhone(s, p.id); s.modals = []; });
      toast(p.real ? `已解除与${p.name}的配对，手机在线时会立即收到通知` : `已解除与${p.name}的配对`, 'trash');
    },
  });
}
export function revokePC(_id: string, _phoneId?: string) {
  unavailable('撤销授权电脑');
}

/* ---------- 配对：真实扫码 / 配对码（R01），见 actions/pairing.ts ---------- */
export { pair, pairNext, pairRefresh, pairTab } from './pairing';
