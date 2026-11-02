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
import { AGENT_PREFIX, memberInfo, specialty } from '../runtime/team';
import { MemberAvatar } from './MemberAvatar';
import { S } from '@/state/store';
import type { TeamMember } from '@/state/types';
import { prettyPath } from '@/shared/lib/util';

type P = Record<string, unknown>;

export function TeamModal({ p }: { p: P }) {
  const f = S.form, add = p.mode === 'add', q = S.q.assist;
  // 可加入的成员：Lom、手机、本机检测到且可用的 Agent（Codex CLI、Kimi……）
  const pool = [
    ...[agent('pc')!, ...phones()].map(a => ({ id: a.id, name: a.name, sub: `${personaOf(a)}${a.kind === 'phone' && a.status === 'offline' ? ' · 离线' : ''}` })),
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
                <span className="grow"><b style={{ fontSize: 15 }}>{a.name}</b><div className="muted" style={{ fontSize: 13 }}>{a.sub}</div></span>
                <Icon name="plus" />
              </button>
            ))}
            <button type="button" className="picker-row" onClick={pair}>
              <Avatar agent={{ kind: 'user', name: '+' }} />
              <span className="grow"><b style={{ fontSize: 15 }}>添加一台新手机</b><div className="muted" style={{ fontSize: 13 }}>扫码配对后即可加入团队</div></span>
              <Icon name="chevronRight" />
            </button>
          </div>
        </div>
        <div className="picker__col">
          <div className="row">
            <div className="picker__title grow">已选成员 {members.length}</div>
            {!add && <span className="muted" style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ color: 'var(--crown)' }}><Icon name="crown" /></span>= Leader</span>}
          </div>
          <div className="picker__hint">{add ? '点击右侧 × 移除成员；也可以从左侧添加。' : '选择团队成员并指定一个 Leader；为每位成员起一个角色名。同一个助手可被多次选择。'}</div>
          <div className="picker__selected">
            {members.length ? members.map(m => {
              const info = memberInfo(m.agent);
              return (
                <div key={m.mid} className="member-row">
                  <MemberAvatar id={m.agent} crown={m.leader} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{info.name}</div>
                    <Input bind={`form.roles.${m.mid}`} value={f.roles?.[m.mid] ?? m.role} placeholder="角色名，例如：美妆运营" onChange={v => formSet('roles', { ...(f.roles || {}), [m.mid]: v })} />
                  </div>
                  {!add && m.agent === 'pc' && <IconBtn ic="crown" label={m.leader ? '取消 Leader' : '设为 Leader'} onClick={() => setLeader(m.mid)} active={m.leader} />}
                  {!(add && m.leader) && <IconBtn ic="close" label="移除" onClick={() => removeAssist(m.mid)} />}
                </div>
              );
            }) : <Empty ic="crown" title={add ? '从左边选择要加入的助手' : '从左边选择成员'} desc={add ? '' : 'Lom 会自动担任 Leader；手机和电脑上的 Agent 当队员。'} />}
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
