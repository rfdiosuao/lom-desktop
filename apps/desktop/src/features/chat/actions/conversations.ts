import { hideHistory } from '@/state/history';
import { changePhoneChat } from '@/features/phones/runtime/phoneChat';
import { deleteTask, exportMarkdown, renameTask } from '../runtime/tasks';
import { sim } from '@/demo/simulator';
import { conv } from '@/state/selectors';
import { S, update } from '@/state/store';
import { uid } from '@/shared/lib/util';
import { confirm, prompt, toast, toastError } from '@/shared/overlays/controller';

/* ===== 会话与分组：重命名、删除、置顶、移动分组、导出 ===== */

export function renameConv(id: string) {
  const c = conv(id);
  if (!c) return;
  prompt({
    title: '重命名', label: '名称', value: c.title,
    onOk: v => { if (!v) return; if (c.phoneSession) void changePhoneChat(c, 'chat.rename', { title: v }).catch(e => toastError('手机会话未重命名', e)); else if (c.remote) void renameTask(c, v); else update(() => { c.title = v; }); },
  });
}

export function deleteConv(id: string) {
  const c = conv(id);
  if (!c) return;
  confirm({
    title: `删除「${c.title}」？`,
    desc: c.owner === 'pc' ? '任务的对话记录会被删除，工作文件夹里的文件不受影响。' : '会话会从手机和电脑上同时删除。',
    okText: '删除', danger: true,
    onOk: async () => {
      if (c.phoneSession) { try { await changePhoneChat(c, 'chat.delete'); } catch (e) { toastError('手机会话未删除', e); return; } }
      if (c.remote && !(await deleteTask(c))) return;
      if (!c.remote) sim.stop(c.id);
      hideHistory(c.historyArchiveId);
      update(s => {
        s.convs = s.convs.filter(x => x.id !== c.id);
        if (s.activeConv === c.id) { s.activeConv = null; s.route = { name: 'home' }; }
      });
      toast('已删除', 'trash');
    },
  });
}

export function pinConv(id: string) {
  const c = conv(id);
  if (!c) return;
  if (c.phoneSession) { void changePhoneChat(c, 'chat.pin', { pinned: !c.pinned }).catch(e => toastError('手机置顶未修改', e)); return; }
  update(() => { c.pinned = !c.pinned; });
  toast(c.pinned ? '已置顶' : '已取消置顶', 'pin');
}

/** 分组只显示没置顶的会话：移入分组时取消置顶；手机会话要在手机上取消，否则下次同步又会置顶回来 */
function unpinForGroup(id: string) {
  const c = conv(id);
  if (!c?.pinned) return;
  if (c.phoneSession) { void changePhoneChat(c, 'chat.pin', { pinned: false }).catch(e => toastError('手机置顶未取消，会话仍显示在置顶里', e)); return; }
  update(() => { c.pinned = false; });
}

export function moveConv(id: string, group: string) {
  update(s => { if (group) s.convGroup[id] = group; else delete s.convGroup[id]; });
  unpinForGroup(id);
  toast(group ? '已移动到分组' : '已移出分组', 'folder');
}

export function newGroup(move?: string) {
  prompt({
    title: '新建分组', label: '分组名称', placeholder: '例如：选题、复盘', okText: '创建',
    onOk: v => {
      if (!v) return;
      const g = { id: uid('g'), name: v };
      update(s => {
        (s.customGroups[s.phoneId] ||= []).push(g);
        if (move) s.convGroup[move] = g.id;
      });
      if (move) unpinForGroup(move);
      toast('分组已创建', 'folder');
    },
  });
}

export function renameGroup(id: string) {
  const g = S.customGroups[S.phoneId]?.find(x => x.id === id);
  if (!g) return;
  prompt({ title: '重命名分组', label: '分组名称', value: g.name, onOk: v => update(() => { g.name = v || g.name; }) });
}

export function deleteGroup(id: string) {
  confirm({
    title: '删除这个分组？', desc: '分组里的会话不会被删除，会回到按日期分组。', okText: '删除', danger: true,
    onOk: () => update(s => {
      s.customGroups[s.phoneId] = (s.customGroups[s.phoneId] || []).filter(x => x.id !== id);
      Object.keys(s.convGroup).forEach(k => { if (s.convGroup[k] === id) delete s.convGroup[k]; });
    }),
  });
}

export function exportConv(id: string) {
  const c = conv(id);
  if (!c) return;
  exportMarkdown(c);
  toast(`已导出「${c.title}.md」`, 'download');
}

export const toggleConvSearch = () => update(s => { s.convSearch = !s.convSearch; if (!s.convSearch) s.q.conv = ''; });
export const foldGroup = (key: string) => update(s => { s.groupFold[key] = !s.groupFold[key]; });
export const toggleEvent = (id: string) => update(s => { s.eventOpen[id] = !s.eventOpen[id]; });
