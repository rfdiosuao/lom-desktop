import { formSet } from '@/features/schedules/actions/schedule';
import { createTeam, pickAssist, removeAssist, saveMembers, setLeader } from '../actions/teams';
import { pair } from '@/features/phones/actions/phone';
import { closeModal } from '@/shared/overlays/controller';
import { Avatar } from '@/shared/ui/Agent';
import { Btn, Dropdown, IconBtn } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { Empty, Field, Input, Search } from '@/shared/ui/Layout';
import { Modal } from '@/shared/ui/Overlay';
import { agent, personaOf, phones } from '@/state/selectors';
import { usable } from '@/features/settings/runtime/agents';
import { AGENT_PREFIX, isAgentMember, memberInfo, specialty } from '../runtime/team';
import { MemberAvatar } from './MemberAvatar';
import { S } from '@/state/store';
import type { TeamMember } from '@/state/types';
import { prettyPath } from '@/shared/lib/util';

type P = Record<string, unknown>;

export function TeamModal({ p }: { p: P }) {
  const f = S.form, add = p.mode === 'add', q = S.q.assist;
  // 可加入的成员：Lom、手机、本机检测到且可用的 Agent（Codex CLI、Kimi……）
  const pool = [
    ...[agent('pc')!, ...phones()].map(a => ({ id: a.id, name: a.id === 'pc' ? 'Lom' : a.name, sub: `${a.id === 'pc' ? '内置电脑助手' : personaOf(a)}${a.kind === 'phone' && a.status === 'offline' ? ' · 离线' : ''}` })),
    ...(S.agentCatalog || []).filter(usable).map(a => ({ id: `${AGENT_PREFIX}${a.id}`, name: a.name, sub: `电脑上的 Agent · ${specialty(a)}` })),
  ].filter(a => !q || a.name.includes(q) || a.sub.includes(q));
  const members: TeamMember[] = f.members || [];
  const ok = add ? members.length > 0 : members.length > 0 && !!f.name;
  return (
    <Modal title={add ? '管理成员' : '新建团队'} size="xl"
      desc={add ? '添加或移除成员、修改角色。Leader 保留，移除不会删除历史对话；运行中的团队请先停止。' : '让多个 AI 助手组队协作。建议一个团队只专注一个目标，不同任务分开建。'}
      foot={<><Btn label="取消" variant="secondary" onClick={closeModal} /><Btn label={add ? '保存' : '确认创建'} variant="primary" onClick={add ? saveMembers : createTeam} disabled={!ok} /></>}>
      <div className="picker">
        <div className="picker__col">
          <div className="picker__title">所有助手 ({pool.length})</div>
          <Search bind="q.assist" placeholder="搜索" />
          <div className="picker__list">
            {pool.map(a => (
              <button key={a.id} type="button" className="picker-row" onClick={() => pickAssist(a.id)}>
                <MemberAvatar id={a.id} status={!!S.agents[a.id] && S.agents[a.id].kind === 'phone'} />
                <span className="grow"><b className="picker-row__name">{a.name}</b><div className="muted picker-row__sub">{a.sub}</div></span>
                <Icon name="plus" />
              </button>
            ))}
            <button type="button" className="picker-row" onClick={pair}>
              <Avatar agent={{ kind: 'user', name: '+' }} />
              <span className="grow"><b className="picker-row__name">添加一台新手机</b><div className="muted picker-row__sub">扫码配对后即可加入团队</div></span>
              <Icon name="chevronRight" />
            </button>
          </div>
        </div>
        <div className="picker__col">
          <div className="row">
            <div className="picker__title grow">已选成员 {members.length}</div>
            {!add && <span className="muted picker__legend"><Icon name="crown" />= Leader</span>}
          </div>
          <div className="picker__hint">{add ? '点击右侧 × 移除成员；也可以从左侧添加。' : '第一个加入的电脑 Agent 默认担任 Leader；后加入的作为成员。手机作为执行成员。'}</div>
          <div className="picker__selected">
            {members.length ? members.map(m => {
              const info = memberInfo(m.agent);
              // UI-AUDIT-04：按钮名称带上成员，读屏能分清是哪一位
              const role = f.roles?.[m.mid] ?? m.role, who = role ? `${info.name}（${role}）` : info.name;
              return (
                <div key={m.mid} className="member-row">
                  <MemberAvatar id={m.agent} crown={m.leader} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="member-row__name">{info.name}</div>
                    <Input bind={`form.roles.${m.mid}`} value={f.roles?.[m.mid] ?? m.role} placeholder="角色名，例如：美妆运营" onChange={v => formSet('roles', { ...(f.roles || {}), [m.mid]: v })} />
                  </div>
                  {!add && (m.agent === 'pc' || isAgentMember(m.agent)) && <IconBtn ic="crown" label={m.leader ? `取消 Leader：${who}` : `设为 Leader：${who}`} onClick={() => setLeader(m.mid)} active={m.leader} />}
                  {!(add && m.leader) && <IconBtn ic="close" label={`移除 ${who}`} onClick={() => removeAssist(m.mid)} />}
                </div>
              );
            }) : <Empty ic="crown" title={add ? '从左边选择要加入的助手' : '从左边选择成员'} desc={add ? '' : '先添加的电脑 Agent 当主控，不限于 Lom；手机作为执行成员。'} />}
          </div>
          {!add && (
            <div style={{ marginTop: 16 }}>
              <Field label="团队名" req inline><Input bind="form.name" placeholder="团队名称，例如：小红书内容工厂" /></Field>
              <Field label="工作空间" inline><Dropdown label={f.folder ? prettyPath(f.folder, S.homeDir) : '选择文件夹'} ic="folder" menu="teamFolder" variant="secondary" ctx={{ key: 'tf' }} /></Field>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
