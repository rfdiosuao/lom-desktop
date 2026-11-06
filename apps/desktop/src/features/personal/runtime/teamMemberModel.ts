import { setConvOption } from '@/features/settings/runtime/agentOptions';
import { S, update } from '@/state/store';
import type { Team } from '@/state/types';
import { checkedModel } from './agentModels';

/** TEAM-ORCH-06（#371）：已建立核心团队的成员换模型。成员还没开工也可以，核心会把它存下来，首次启动时采用。 */
export type MemberModelOutcome = { status: 'switched' | 'saved_for_next_turn' | 'submitted_unconfirmed'; team_id: string; member_id: string; model: string; session_id: string; note: string };

export async function switchMemberModel(
  t: Team, memberId: unknown, rawModel: unknown, ask: (summary: string) => Promise<void>, live: () => boolean,
): Promise<MemberModelOutcome> {
  if (!t.core) throw new Error('团队还没有开工，没有核心会话；开工前请用 personal_team_configure 给成员写 model');
  const member = t.members.find(m => m.mid === memberId);
  if (!member) throw new Error('找不到这个成员，请先 personal_team_read 核对 member_id');
  if (!member.agent.startsWith('ag:')) throw new Error('只有电脑上的外部 Agent 成员能换模型；Lom 沿用桌面当前模型，手机不支持');
  if (rawModel === undefined || rawModel === 'auto') throw new Error('请指定一个具体模型（auto 只用于建队时表示沿用默认）');
  const model = checkedModel(member.agent.slice(3), rawModel);
  if (!model) throw new Error('model 不能为空');
  const sessionId = member.leader ? t.leaderConv : t.memberConvs?.[member.mid];
  const conv = sessionId ? S.convs.find(c => c.id === sessionId) : undefined;
  if (!conv) throw new Error('这个成员的会话还没建立，暂时无法换模型；请稍后再试或在团队界面操作');
  await ask(`把团队「${t.name}」成员「${member.role}」的模型改为 ${model}。`);
  if (!live()) throw new Error('助理已停止、账号、权限或目标已变化；未提交，请核对');
  const result = await setConvOption(conv, 'model', model);
  if (!live()) throw new Error('助理已停止或目标已变化；换模型请求已发出，请核对实际结果，不自动重试');
  if (result === 'command_ack') {
    return { status: 'submitted_unconfirmed', team_id: t.id, member_id: member.mid, model, session_id: conv.id, note: '核心收到了请求但没有确认是否生效，请用 personal_team_read 或在团队界面核对；团队名单里的模型未改。' };
  }
  update(() => { member.model = model; });
  return result === 'observed'
    ? { status: 'switched', team_id: t.id, member_id: member.mid, model, session_id: conv.id, note: '核心已确认切换。' }
    : { status: 'saved_for_next_turn', team_id: t.id, member_id: member.mid, model, session_id: conv.id, note: '已保存；成员下一轮（或首次启动）开始使用，当前轮不受影响。' };
}
