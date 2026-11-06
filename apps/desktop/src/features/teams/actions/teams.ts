import { stopTeamPhones, teamPhoneConversations } from '../runtime/phoneLifecycle';
import { invalidateTeamOperations, teamOperationPending } from '../runtime/teamGuard';
import { createTeamConfiguration } from '../runtime/configuration';
import { agent, team } from '@/state/selectors';
import { isAgentMember, leaderMember, memberAgentRow } from '../runtime/team';
import { focusMemberView } from '../activity/activityFocus';
import { memberLaneNotice } from '../activity/memberLanes';
import { removeCoreTeam, stopCoreTeam, syncCoreMembers } from '../runtime/coreTeam';
import { exportTeamMarkdown } from '../runtime/teamExport';
import { markdownFileName, saveMarkdown } from '@/features/chat/runtime/exportMarkdown';
import { stopTask } from '@/features/chat/runtime/cancel';
import { loadAgents } from '@/features/settings/runtime/agents';
import { cachedOptions, probeAgentOptions } from '@/features/settings/runtime/agentOptions';
import { S, update } from '@/state/store';
import type { Team, TeamMember } from '@/state/types';
import { uid } from '@/shared/lib/util';
import { navigate } from '@/app/navigation';
import { closeModal, confirm, openModal, prompt, toast, toastError, topModal } from '@/shared/overlays/controller';

/* ---------- OPC 团队 ---------- */
export const newTeam = () => { if (!S.agentCatalog) void loadAgents(); S.q.assist = ''; S.form = { name: '', folder: '', members: [], roles: {} }; openModal('team', { mode: 'create' }); };
export const addMember = (id: string) => {
  const t = team(id); if (!t) return;
  if (!S.agentCatalog) void loadAgents();
  S.q.assist = ''; S.form = { members: t.members.map(m => ({ ...m })), roles: {} };
  openModal('team', { mode: 'add', id });
};

/** 加入成员：Lom、手机或本机 Agent（'ag:<编号>'）。电脑 Agent 可担任 Leader，手机作为执行成员 */
export function pickAssist(id: string) {
  const a = agent(id), row = memberAgentRow(id);
  if (!a && !row) return;
  // 同一团队只保留一位 Lom；外部 Agent 可创建多个独立成员。
  if (id === 'pc' && S.form.members.some((m: TeamMember) => m.agent === 'pc')) { toast('团队里已经有 Lom 了：Lom 只能加入一次，其他助手可以重复添加', 'info'); return; }
  update(s => {
    const f = s.form;
    const lom = id === 'pc', create = topModal()?.props.mode === 'create';
    const leader = (lom || !!row) && create && !f.members.some((m: TeamMember) => m.leader);
    const role = lom ? (leader ? '总编' : '执行') : leader ? '主控' : row ? specialtyRole(row.backend) : a?.persona ? `${a.persona.replace('博主', '')}运营` : '运营';
    f.members.push({ mid: uid('m'), agent: id, role, leader });
  });
  // 本机 Agent 第一次进团队：顺手读一次它自己配置的模型，团队窗口里才能显示
  if (row && !cachedOptions(row.id)) void probeAgentOptions(row);
}
const specialtyRole = (backend?: string) => ({ codex: '电脑操作', kimi: '看视频', pi: '编程', codebuddy: '执行', claude: '编程' } as Record<string, string>)[backend || ''] || '执行';
export const removeAssist = (mid: string) => update(s => {
  if (topModal()?.props.mode === 'add' && s.form.members.find((m: TeamMember) => m.mid === mid)?.leader) return;
  s.form.members = s.form.members.filter((x: TeamMember) => x.mid !== mid);
  if (!s.form.members.some((m: TeamMember) => m.leader)) {
    const first = s.form.members.find((m: TeamMember) => m.agent === 'pc' || isAgentMember(m.agent));
    if (first) first.leader = true;
  }
});
export const setLeader = (mid: string) => update(s => {
  const target = s.form.members.find((m: TeamMember) => m.mid === mid);
  if (!target || (target.agent !== 'pc' && !isAgentMember(target.agent))) { toast('电脑 Agent 可担任 Leader，手机作为执行成员', 'info'); return; }
  s.form.members.forEach((m: TeamMember) => { m.leader = m.mid === mid ? !m.leader : false; });
});

const membersFromForm = (f: Record<string, any>): TeamMember[] => f.members.map((m: TeamMember) => ({ ...m, role: (f.roles?.[m.mid] ?? m.role) || '成员' }));

export function createTeam() {
  const f = S.form;
  const members = membersFromForm(f);
  // 第一个电脑 Agent 默认主控，不再额外插入 Lom。手机没有团队主控运行时。
  const first = members.find(m => m.agent === 'pc' || isAgentMember(m.agent));
  if (!first) { toast('请添加一位电脑 Agent 担任主控，手机作为执行成员', 'info'); return; }
  if (!members.some(m => m.leader)) first.leader = true;
  const real = members.every(m => m.agent === 'pc' || isAgentMember(m.agent) || S.agents[m.agent]?.real);
  let t: Team;
  try { t = createTeamConfiguration({ name: f.name, folder: f.folder, members, real }); }
  catch (e) { toastError('未创建团队', e); return; }
  update(s => { s.modals = []; });
  // TEAM-FOCUS-01：看板里没有 Leader 窗格，提示看板上的入口；并排 / 单个视图才有 Leader 窗格
  const start = S.teamView === 'board' ? '点「和 Leader 说目标」开工' : '在 Leader 窗格里说目标即可开工';
  toast(real ? `团队「${t.name}」已创建，${start}` : `团队「${t.name}」含示例手机，只能演示`, real ? 'check' : 'info');
  navigate({ mode: 'desktop', route: { name: 'team', id: t.id }, teamFocus: members.find(m => m.leader)?.mid ?? members[0]?.mid });
}

export function saveMembers() {
  const t = team(topModal()?.props.id as string);
  if (!t) return;
  if (teamBusy(t)) { toast('请先停止团队，再保存成员变更', 'info'); return; }
  const members = membersFromForm(S.form);
  const leader = t.members.find(m => m.leader);
  if (leader && !members.some(m => m.mid === leader.mid && m.leader)) { toast('请保留团队 Leader', 'info'); return; }
  update(s => {
    t.members = members;
    t.real = members.every(m => m.agent === 'pc' || isAgentMember(m.agent) || s.agents[m.agent]?.real);
    if (!members.some(m => m.mid === s.teamFocus)) s.teamFocus = leader?.mid || members[0]?.mid || '';
    if (t.leaderConv) s.convPhones[t.leaderConv] = members.map(m => m.agent).filter(id => s.agents[id]?.real);
  });
  closeModal();
  if (!t.core) { toast('成员已更新；保留原对话记录，Leader 下次开工使用新名单', 'check'); return; }
  void syncCoreMembers(t).then(() => toast('成员已更新，团队成员之间可以直接互发消息', 'check'), e => toastError('成员同步到团队失败，下次发送前会自动重试', e));
}

/** 团队里有没有成员会话正在运行：Leader、成员会话和派给手机的团队会话 */
export const teamBusy = (t: Team) => S.convs.some(c => (c.teamId === t.id || c.id === t.leaderConv || Object.values(t.memberConvs || {}).includes(c.id)) && !!S.running[c.id]);

/** UI-AUDIT-04：「停止团队」只在确定没有任务可停时（示例团队、从未开工）才不可用，并给出可见原因。
 *  本地运行标记看不到内核里没有本地会话的成员，重启后也不一定恢复，所以「看起来都空闲」时仍可点，
 *  点下去由停止结果说明「团队现在没有在运行」。 */
export function stopTeamState(t: Team): { enabled: boolean; hint: string } {
  if (!t.real) return { enabled: false, hint: '示例团队没有真实运行，不能停止' };
  if (teamOperationPending(t)) return { enabled: true, hint: '取消正在准备或等待批准的团队派活' };
  if (!t.leaderConv && !t.core && !teamPhoneConversations(t).length) return { enabled: false, hint: '团队还没有开工，没有可停止的任务' };
  if (teamBusy(t)) return { enabled: true, hint: '停止团队所有成员正在运行的任务' };
  return { enabled: true, hint: '停止团队里可能仍在运行的任务；没有在运行时会告诉你' };
}

/** 停止团队：内核团队取消整轮运行（所有成员一起停）；之前建的团队只停 Leader 和它派出去的任务 */
export function stopTeam(id: string) {
  const t = team(id);
  if (!t) return;
  invalidateTeamOperations(t);
  // 本地看不准是否空闲，按钮开工后一直可用；核心那边没有运行（且没有手机被停下）时提示没在运行
  if (t.core || (!t.leaderConv && teamPhoneConversations(t).length)) { void stopCoreTeam(t).then(r => toast(r?.stopped || r?.phones ? '团队已停止' : '团队现在没有在运行', 'stop'), e => toastError('停止团队失败', e)); return; }
  if (t.leaderConv) {
    void Promise.all([stopTask(t.leaderConv), stopTeamPhones(t, () => S.teams.includes(t))])
      .catch(e => toastError('停止团队手机失败', e));
  }
}

export const teamFocus = (mid: string) => update(s => { s.teamFocus = mid; });

/** TEAM-FOCUS-01：顶栏选成员。看板 / 并排视图把它的列或窗格滚到可见处；没有列时说明原因，不假装已定位 */
export function focusTeamMember(id: string, mid: string) {
  teamFocus(mid);
  const t = team(id);
  if (!t || S.teamView === 'single' || focusMemberView(mid)) return;
  toast(memberLaneNotice(t, mid, S), 'info');
}

/** 把建议填进这个成员的输入框。看板里没有输入框：切到单个视图并选中这位成员，输入框出现后拿到焦点 */
export const fillTeamDraft = (teamId: string, memberId: string, text: string) => {
  const ckey = `team:${teamId}:${memberId}`;
  update(s => {
    s.drafts[ckey] = text; s.focusNext = `composer:${ckey}`; s.teamFocus = memberId;
    if (s.teamView === 'board') s.teamView = 'single';
  });
};

/** TEAM-FOCUS-01：看板空状态「和 Leader 说目标」：在单个视图里打开 Leader，焦点交给它的输入框 */
export function talkToLeader(id: string) {
  const t = team(id), leader = t && leaderMember(t);
  if (!t || !leader) return;
  update(s => { s.teamView = 'single'; s.teamFocus = leader.mid; s.focusNext = `composer:team:${t.id}:${leader.mid}`; });
}

export const paneMax = (mid: string) => update(s => { if (s.teamView === 'single') s.teamView = 'side'; else { s.teamView = 'single'; s.teamFocus = mid; } });

export function clearPane(id: string, mid: string) {
  const t = team(id);
  if (!t) return;
  confirm({ title: '清空这位成员的对话？', desc: '只清空当前窗格的记录，不影响其他成员。', okText: '清空', danger: true, onOk: () => update(() => { t.panes[mid] = []; }) });
}

/** 团队名称规则：去掉首尾空白后不能为空（与新建团队一致）；在弹窗内提示，不悄悄保留旧名 */
export const teamNameError = (name: string) => (name.trim() ? undefined : '请输入团队名称');

export function renameTeam(id: string) {
  const t = team(id);
  if (!t) return;
  prompt({ title: '重命名团队', label: '团队名称', value: t.name, validate: teamNameError, onOk: v => update(() => { t.name = v.trim(); }) });
}

/** TEAM-MENU-01：把团队各成员的记录导出为一个 Markdown 文件；真正保存了才提示，读取失败的成员在提示里列出 */
export async function exportTeam(id: string) {
  const t = team(id);
  if (!t) return;
  const name = markdownFileName(t.name);
  try {
    const { markdown, failed } = await exportTeamMarkdown(t);
    if (!(await saveMarkdown(name, markdown))) return;
    if (failed.length) toast(`已导出「${name}」，但这些成员的记录读取失败、没有包含：${failed.join('、')}`, 'info');
    else toast(`已导出「${name}」`, 'download');
  } catch (e) { toastError('导出团队记录失败，没有生成文件', e); }
}

export function deleteTeam(id: string) {
  const t = team(id);
  if (!t) return;
  confirm({
    title: `解散「${t.name}」？`, desc: '团队对话记录会被删除，成员（电脑主控与手机）不受影响。', okText: '解散', danger: true,
    onOk: async () => {
      // 先删内核里的团队，确认删掉了再移除本地入口；失败时团队还在，可以再点一次解散
      if (t.core) {
        try { await removeCoreTeam(t.core); }
        catch (e) { toastError('解散失败，团队还在运行，可以稍后再试', e); return; }
      }
      update(s => { s.teams = s.teams.filter(x => x.id !== t.id); s.route = { name: 'teams' }; });
      toast('团队已解散', 'trash');
    },
  });
}

/** Open the board lane's member in the existing single-conversation view. */
export function openTeamMember(id: string, mid: string) {
  const t = team(id);
  if (!t?.members.some(m => m.mid === mid)) { toast('该团队成员已不存在，请刷新看板', 'info'); return false; }
  update(s => { s.teamFocus = mid; s.teamView = 'single'; });
  navigate({ route: { name: 'team', id } });
  return true;
}
