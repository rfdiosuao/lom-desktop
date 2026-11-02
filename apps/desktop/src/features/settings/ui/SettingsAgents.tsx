import { useEffect, useState } from 'react';
import { addCustomAgent, checkAgent, isTesting, pinAgent, unpinAgent } from '../actions/agents';
import { Btn } from '@/shared/ui/Button';
import { Badge, Seg } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { ListRow, PageHead } from '@/shared/ui/Layout';
import { loadAgents, logoUrl, usable, type AgentRow } from '../runtime/agents';
import { useStore } from '@/state/store';

/* ===== 设置 → Agents：本机可用的 AI 编程 Agent =====
 * Lom 内置，始终可用；其他 Agent 由核心检测本机已安装的 CLI。加到切换器后，在中栏左上角切换。 */

function status(a: AgentRow): { text: string; tone?: 'ok' | 'warn' | 'danger' } {
  if (!a.installed || a.status === 'missing') return { text: '未安装', tone: 'danger' };
  if (a.status === 'offline') return { text: '不可用', tone: 'warn' };
  if (a.status === 'unchecked') return { text: '未检测' };
  return { text: '可用', tone: 'ok' };
}

function Logo({ src }: { src?: string }) {
  const url = logoUrl(src);
  return <span className="agent-logo">{url ? <img src={url} alt="" /> : <Icon name="cube" />}</span>;
}

type Tab = 'all' | 'ok' | 'off';

export function AgentsPage() {
  const s = useStore();
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  useEffect(() => { if (s.conn === 'ready') void loadAgents(); }, [s.conn]);
  const rows = s.agentCatalog ?? [];
  const okCount = rows.filter(a => a.installed && a.status !== 'missing').length;
  const shown = rows
    .filter(a => (tab === 'all' ? true : tab === 'ok' ? a.installed && a.status !== 'missing' : !a.installed || a.status === 'missing'))
    .filter(a => !q.trim() || a.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name));
  return <>
    <PageHead title="Agents" desc="管理本机可用的 AI 编程 Agent。Lom 是内置的总指挥，无需安装；其他 Agent 需要先在本机安装对应的 CLI 才能被识别。加到切换器后，可以在左上角切换新任务使用的 Agent。"
      actions={<Btn label="添加自定义 Agent" ic="plus" variant="primary" onClick={addCustomAgent} disabled={s.conn !== 'ready'} />} />
    <div className="row" style={{ gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
      <Seg options={[{ value: 'all', label: `全部 ${rows.length + 1}` }, { value: 'ok', label: `可用 ${okCount + 1}` }, { value: 'off', label: `不可用 ${rows.length - okCount}` }]} value={tab} onChange={v => setTab(v as Tab)} />
      <div className="grow" />
      <input className="input agent-search" placeholder="搜索 Agent…" value={q} onChange={e => setQ(e.target.value)} aria-label="搜索 Agent" />
      <Btn label="重新检测" ic="refresh" variant="secondary" size="sm" onClick={() => void loadAgents()} disabled={s.conn !== 'ready'} />
    </div>
    {s.agentsError && <p className="form-error" style={{ marginBottom: 10 }}>{s.agentsError}</p>}
    <div className="list">
      {tab !== 'off' && !q.trim() && (
        <ListRow lead={<span className="agent-logo"><img src="/logo.png" alt="" /></span>} title="Lom" titleExtra={<Badge text="内置 · 可用" tone="ok" />}
          sub="麓鸣的总指挥：使用你在「模型与额度」里选的模型，可以指挥手机。" actions={<Badge text="始终在切换器" />} />
      )}
      {s.conn !== 'ready' && <div className="list-row muted">核心服务未连接，无法检测本机 Agent</div>}
      {s.conn === 'ready' && !s.agentCatalog && <div className="list-row muted">正在检测本机 Agent…</div>}
      {shown.map(a => {
        const st = status(a), pinned = s.agentPins.includes(a.id), testing = isTesting(a.id);
        return (
          <ListRow key={a.id} lead={<Logo src={a.icon} />} title={a.name} titleExtra={<Badge text={st.text} tone={st.tone} />}
            sub={a.last_check_error_message && a.status !== 'online' ? a.last_check_error_message : a.description || (a.backend ? `命令行：${a.backend}` : undefined)}
            actions={<>
              <Btn label={testing ? '测试中…' : '测试连接'} variant="secondary" size="sm" onClick={() => void checkAgent(a.id)} disabled={testing || !a.installed} />
              {pinned
                ? <Btn label="从切换器移除" variant="ghost" size="sm" onClick={() => unpinAgent(a.id)} />
                : <Btn label="加到切换器" variant="secondary" size="sm" onClick={() => pinAgent(a.id)} disabled={!usable(a) && a.status !== 'unchecked'} />}
            </>} />
        );
      })}
    </div>
  </>;
}
