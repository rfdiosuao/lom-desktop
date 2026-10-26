import { agent, team } from '@/state/selectors';
import { isAgentMember, memberAgentRow } from '../runtime/team';
import { removeCoreTeam, stopCoreTeam, syncCoreMembers } from '../runtime/coreTeam';
import { stopTask } from '@/features/chat/runtime/cancel';
import { loadAgents } from '@/features/settings/runtime/agents';
import { cachedOptions, probeAgentOptions } from '@/features/settings/runtime/agentOptions';
import { S, update } from '@/state/store';
import type { TeamMember } from '@/state/types';
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

/** 加入成员：Lom、手机或本机 Agent（'ag:<编号>'）。Leader 只能是 Lom：只有它能指挥手机和其他 Agent */
export function pickAssist(id: string) {
  const a = agent(id), row = memberAgentRow(id);
  if (!a && !row) return;
  update(s => {
    const f = s.form;
    const lom = id === 'pc', create = topModal()?.props.mode === 'create';
    const leader = lom && create && !f.members.some((m: TeamMember) => m.leader);
    const role = lom ? (leader ? '总编' : '执行') : row ? specialtyRole(row.backend) : a?.persona ? `${a.persona.replace('博主', '')}运营` : '运营';
    f.members.push({ mid: uid('m'), agent: id, role, leader });
  });
  // 本机 Agent 第一次进团队：顺手读一次它自己配置的模型，团队窗口里才能显示
  if (row && !cachedOptions(row.id)) void probeAgentOptions(row);
}
const specialtyRole = (backend?: string) => ({ codex: '电脑操作', kimi: '看视频', pi: '编程', codebuddy: '执行', claude: '编程' } as Record<string, string>)[backend || ''] || '执行';
export const removeAssist = (mid: string) => update(s => {
  if (topModal()?.props.mode === 'add' && s.form.members.find((m: TeamMember) => m.mid === mid)?.leader) return;
  s.form.members = s.form.members.filter((x: TeamMember) => x.mid !== mid);
});
export const setLeader = (mid: string) => update(s => {
  const target = s.form.members.find((m: TeamMember) => m.mid === mid);
  if (target?.agent !== 'pc') { toast('Leader 只能是 Lom：只有它能指挥手机和其他 Agent', 'info'); return; }
  s.form.members.forEach((m: TeamMember) => { m.leader = m.mid === mid ? !m.leader : false; });
});

const membersFromForm = (f: Record<string, any>): TeamMember[] => f.members.map((m: TeamMember) => ({ ...m, role: (f.roles?.[m.mid] ?? m.role) || '成员' }));

export function createTeam() {
  const f = S.form;
  const members = membersFromForm(f);
  // 没选 Lom 就自动加上它当 Leader
  if (!members.some(m => m.leader)) members.unshift({ mid: uid('m'), agent: 'pc', role: '总编', leader: true });
  const real = members.every(m => m.agent === 'pc' || isAgentMember(m.agent) || S.agents[m.agent]?.real);
  const t = { id: uid('t'), name: f.name, folder: f.folder || S.folder, created: Date.now(), members, panes: {}, real };
  update(s => { s.teams.unshift(t); s.modals = []; });
  toast(real ? `团队「${t.name}」已创建，在 Leader 窗格里说目标即可开工` : `团队「${t.name}」含示例手机，只能演示`, real ? 'check' : 'info');
  navigate({ mode: 'desktop', route: { name: 'team', id: t.id }, teamFocus: members.find(m => m.leader)?.mid ?? members[0]?.mid });
}

export function saveMembers() {
  const t = team(topModal()?.props.id as string);
  if (!t) return;
  const busy = S.convs.some(c => (c.teamId === t.id || c.id === t.leaderConv || Object.values(t.memberConvs || {}).includes(c.id)) && S.running[c.id]);
  if (busy) { toast('请先停止团队，再保存成员变更', 'info'); return; }
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

/** 停止团队：内核团队取消整轮运行（所有成员一起停）；之前建的团队只停 Leader 和它派出去的任务 */
export function stopTeam(id: string) {
  const t = team(id);
  if (!t) return;
  if (t.core) { void stopCoreTeam(t).then(r => toast(r?.stopped ? '团队已停止' : '团队现在没有在运行', 'stop'), e => toastError('停止团队失败', e)); return; }
  if (t.leaderConv) void stopTask(t.leaderConv);
}

export const teamFocus = (mid: string) => update(s => { s.teamFocus = mid; });
export const paneMax = (mid: string) => update(s => { if (s.teamView === 'single') s.teamView = 'side'; else { s.teamView = 'single'; s.teamFocus = mid; } });

export function clearPane(id: string, mid: string) {
  const t = team(id);
  if (!t) return;
  confirm({ title: '清空这位成员的对话？', desc: '只清空当前窗格的记录，不影响其他成员。', okText: '清空', danger: true, onOk: () => update(() => { t.panes[mid] = []; }) });
}

export function renameTeam(id: string) {
  const t = team(id);
  if (!t) return;
  prompt({ title: '重命名团队', label: '团队名称', value: t.name, onOk: v => update(() => { t.name = v || t.name; }) });
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
