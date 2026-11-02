import { newTeam } from '../actions/teams';
import { go } from '@/app/navigation';
import { Btn } from '@/shared/ui/Button';
import { Badge } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { Empty, PageHead, Section } from '@/shared/ui/Layout';
import { useStore } from '@/state/store';
import { memberInfo } from '../runtime/team';
import { MemberAvatar } from './MemberAvatar';
import { ago } from '@/shared/lib/util';
import { Page } from '@/shared/ui/Page';

/* ===== OPC 团队：列表与说明。团队页（活动看板）见 TeamPage.tsx ===== */

export function TeamsPage() {
  const s = useStore();
  const tips: [string, string, string][] = [['crown', 'Lom 当 Leader', '你只和 Leader 说目标。它先「开图」：摸清每台手机装了哪些应用、哪些已登录、电量和权限，记进 TEAM.md，再分派。'], ['columns', '看板一列一个成员', '成员之间收发的消息和任务按人分列，未读、时间、依赖一眼看到，不用挨个窗口翻。'], ['hand', '按特长分工', 'Codex CLI 控制电脑，Kimi 看视频，Pi 编程，CodeBuddy 便宜干活；美团已登录的手机可以点外卖、代购。']];
  return (
    <Page>
      <PageHead title="OPC 团队" desc="一人公司的 AI 团队：把电脑主控和多台手机组成团队，指定一位 Leader 分工协作。建议一个团队只专注一个目标。"
        actions={<Btn label="新建团队" ic="plus" variant="primary" onClick={newTeam} />} />
      {s.teams.length ? (
        <div className="grid-cards">
          {s.teams.map(t => {
            const leader = t.members.find(m => m.leader) ?? t.members[0];
            return (
              <button key={t.id} type="button" className="card card--hover team-card" onClick={() => go('team', t.id)}>
                <div className="row"><span className="avatar-stack">{t.members.slice(0, 5).map(m => <MemberAvatar key={m.mid} id={m.agent} crown={m.leader} />)}</span><span className="grow" />{!t.real && <Badge text="示例" />}<Badge text={`${t.members.length} 位成员`} /></div>
                <div><div className="skill-card__name">{t.name}</div><div className="skill-card__author"><Icon name="folder" /> {t.folder || '当前工作文件夹'}</div></div>
                <div className="muted" style={{ fontSize: 13 }}>Leader：{memberInfo(leader?.agent ?? 'pc').name} · {leader?.role}　创建于 {ago(t.created)}</div>
              </button>
            );
          })}
          <button type="button" className="card card--hover" onClick={newTeam} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 150, borderStyle: 'dashed', color: 'var(--muted)' }}><Icon name="plus" /> 新建团队</button>
        </div>
      ) : <Empty ic="people" title="还没有团队" desc="比如「小红书内容工厂」：电脑主控当总编，手机一号、手机二号分别运营两个账号。" actions={<Btn label="新建团队" ic="plus" variant="primary" onClick={newTeam} />} />}
      <Section title="怎么协作">
        <div className="grid-cards">{tips.map(([ic, t, d]) => <div key={t} className="card"><div className="row" style={{ marginBottom: 6 }}><Icon name={ic} /><b>{t}</b></div><div className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>{d}</div></div>)}</div>
      </Section>
    </Page>
  );
}
