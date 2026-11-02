import { archiveTask, compactTask, editGoal, effortName, effortResult, setGoal, setTaskEffort } from '../runtime/commands';
import { closeSideChat, openSideChat } from '../runtime/sideChat';
import { deferSwitch } from '../runtime/deferredSwitch';
import { convOfKey } from '@/features/teams/runtime/team';
import { S, update } from '@/state/store';
import { coreTeamOf } from '@/state/selectors';
import type { Conv } from '@/state/types';
import { confirm, openMenu, openModal, prompt, toast, toastError } from '@/shared/overlays/controller';

/* ===== 斜杠命令和任务菜单共用的操作（逻辑在 core/commands.ts、core/sideChat.ts） ===== */

const clearDraft = (key: string) => update(s => { s.drafts[key] = ''; s.menu = null; });
const anchor = (key: string) => document.querySelector<HTMLElement>(`[data-composer="${key}"]`)?.closest<HTMLElement>('.composer') ?? document.body;

/** 内核团队里的会话由团队运行时管理：压缩、推理强度、目标这类单任务命令不适用 */
const inCoreTeam = (key: string) => key.startsWith('team:') || !!coreTeamOf(convOfKey(key)?.id);
const teamOnly = (key: string, what: string) => { clearDraft(key); toast(`OPC 团队里不用${what}：直接把要求告诉 Leader，它会分派并跟进`, 'info'); };

export function compactCmd(key: string) {
  if (inCoreTeam(key)) { teamOnly(key, '压缩'); return; }
  const c = convOfKey(key);
  clearDraft(key);
  if (!c?.remote) { toast('先打开一个电脑上的任务，再压缩它的上下文', 'info'); return; }
  void compactTask(c).catch(e => toastError('压缩失败', e));
}

export function archiveCmd(c?: Conv) {
  if (!c?.remote) { toast('先打开一个电脑上的任务', 'info'); return; }
  confirm({
    title: `归档「${c.title}」？`, desc: '归档后不在左侧列表显示，内容都保留；随时可以在「最近任务」旁的归档按钮里恢复。', okText: '归档',
    onOk: () => void archiveTask(c).then(() => toast('已归档', 'archive'), e => toastError('归档失败', e)),
  });
}

export function sideChatCmd(key: string, preserveDraft = false) {
  const c = convOfKey(key);
  if (preserveDraft) update(s => { s.menu = null; });
  else clearDraft(key);
  if (!c?.remote || c.owner !== 'pc' || c.sideOf) { toast('先打开一个电脑上的任务，侧边聊天会带上它的对话', 'info'); return; }
  void openSideChat(c.id).catch(e => toastError('打开侧边对话失败', e));
}
export const closeSide = () => void closeSideChat().catch(e => toastError('关闭侧边聊天失败', e));

export function effortCmd(key: string) {
  if (inCoreTeam(key)) { teamOnly(key, '推理强度'); return; }
  clearDraft(key);
  openMenu('effort', anchor(key), { ckey: key, key: `effort${key}`, matchWidth: 'true' });
}

export async function pickEffort(key: string, value: string) {
  update(s => { s.menu = null; });
  const c = convOfKey(key);
  if (!c) {
    // 新任务页：外部 Agent 用它自己报的档位值预选；Lom 任务沿用低/中/高
    const agentId = S.agentPick;
    if (agentId) { update(s => { s.agentEffortPick[agentId] = value; }); toast(`新任务的推理强度：${value}（创建任务时下发）`, 'brain'); return; }
    update(s => { s.effortPick = value; });
    toast(`新任务的推理强度：${effortName(value)}`, 'brain');
    return;
  }
  // D36：Lom 任务运行中选的推理强度，这一轮结束后自动生效
  if (!c.agentId && S.running[c.id]) { deferSwitch(c.id, { effort: value }, `推理强度 ${effortName(value)}`); return; }
  try {
    const r = await setTaskEffort(c, value);
    const result = effortResult(r, value);
    toast(result.text, result.kind);
  } catch (e) { toastError('调整推理强度失败', e); }
}

export function memoryCmd(key: string) {
  const c = convOfKey(key);
  clearDraft(key);
  const workspace = c?.workspace || (key === 'home' ? S.folder : '');
  if (!workspace) { toast('这个任务没有工作文件夹，找不到对应的记忆', 'info'); return; }
  openModal('lomMemory', { workspace });
}

/** 目标挂在哪个 key 上：任务页、团队窗格是它的会话；新任务页是 home（发出第一条后归到新任务） */
export function goalKeyOf(key: string): string | null {
  if (inCoreTeam(key)) return null;
  const c = convOfKey(key);
  if (c) return `conv:${c.id}`;
  return key === 'home' ? 'home' : null;
}

/** /goal：设定目标并立刻发出去，Agent 开始干活，之后每轮结束自动接着推进，直到目标达成。
 * startNow：把目标正文发出去（composer 传进来，避免循环引用）；没写目标就弹窗问 */
export function goalCmd(key: string, startNow?: (text: string) => void) {
  if (inCoreTeam(key)) { teamOnly(key, ' /goal'); return; }
  // 去掉开头的命令词：输入的「/goal 」，或从斜杠菜单选时的筛选词（「/」「/目」「/go」）
  const typed = (S.drafts[key] || '').replace(/^\/\S*\s*/, '').trim();
  const target = goalKeyOf(key);
  clearDraft(key);
  if (!target) { toast('团队成员还没开始对话：先发一条消息，再设目标', 'info'); return; }
  const start = (text: string) => {
    if (!text.trim()) return;
    setGoal(target, text);
    if (startNow) startNow(text.trim());
  };
  if (typed) { start(typed); return; }
  prompt({ title: '设定目标', label: '这个任务要达成什么？Agent 会一轮一轮推进，直到达成', value: '', placeholder: '例如：做完个人作品集网站并部署到 GitHub Pages', okText: '开始', onOk: start });
}

/** 斜杠菜单里选「目标」：设好后同样立刻发出去（composer 动态加载，避免循环引用） */
export const startGoalCmd = (key: string) => goalCmd(key, goal => void import('./composer').then(m => { update(s => { s.drafts[key] = goal; }); return m.send(key); }));

/** 改目标的文字（进行中的目标栏上的按钮） */
export function editGoalCmd(goalKey: string) {
  const g = S.goals[goalKey];
  if (!g) return;
  prompt({ title: '修改目标', label: '目标', value: g.text, okText: '保存', onOk: v => { if (v.trim()) { editGoal(goalKey, v); toast('目标已更新，下一轮按新目标推进', 'flag'); } } });
}
