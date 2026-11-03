import { useEffect, useState } from 'react';
import { addCustomAgent, checkAgent, isTesting, pinAgent, unpinAgent } from '../actions/agents';
import { Btn } from '@/shared/ui/Button';
import { Badge, Seg } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { ListRow, PageHead } from '@/shared/ui/Layout';
import { toast } from '@/shared/overlays/controller';
import { loadAgents, logoUrl, type AgentRow } from '../runtime/agents';
import { agentHint, agentState, canPin, STATE_BADGE, type AgentState } from '../runtime/agentState';
import { useStore } from '@/state/store';

/* ===== 设置 → Agents：本机可用的 AI 编程 Agent =====
 * Lom 内置，始终可用；其他 Agent 由核心检测本机已安装的 CLI。加到切换器后，在中栏左上角切换。
 * 分类、计数、徽标和能否加入切换器都用 agentState 这一份规则（UI-AUDIT-02 UI-02）。 */

const LOM_NAME = 'Lom', LOM_DESC = '麓鸣的总指挥：使用你在「模型与额度」里选的模型，可以指挥手机。';

function Logo({ src }: { src?: string }) {
  const url = logoUrl(src);
  return <span className="agent-logo">{url ? <img src={url} alt="" /> : <Icon name="cube" />}</span>;
}

type Tab = 'all' | 'ok' | 'todo' | 'missing';
const TAB_OF: Record<AgentState, Exclude<Tab, 'all'>> = { ok: 'ok', unchecked: 'todo', login: 'todo', error: 'todo', missing: 'missing' };

const matches = (q: string, ...text: (string | undefined)[]) => !q || text.some(x => x?.toLowerCase().includes(q));

/** 失败条目：一句中文原因 + 可展开、可复制的原始诊断（UI-04） */
function Diagnosis({ a }: { a: AgentRow }) {
  const hint = agentHint(a), raw = a.last_check_error_message;
  if (!hint) return <>{a.description || (a.backend ? `命令行：${a.backend}` : undefined)}</>;
  return <span className="agent-diag">
    <span>{hint}</span>
    {raw && <details className="agent-diag__more">
      <summary>诊断详情</summary>
      <pre className="agent-diag__raw">{raw}</pre>
      <Btn label="复制诊断" ic="copy" variant="link" size="sm" onClick={() => { void navigator.clipboard?.writeText(`${a.name}${a.backend ? ` (${a.backend})` : ''}\n${raw}`).then(() => toast('诊断已复制')); }} />
    </details>}
  </span>;
}

export function AgentsPage() {
  const s = useStore();
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  useEffect(() => { if (s.conn === 'ready') void loadAgents(); }, [s.conn]);
  const rows = s.agentCatalog ?? [];
  const count = (t: Exclude<Tab, 'all'>) => rows.filter(a => TAB_OF[agentState(a)] === t).length;
  const needle = q.trim().toLowerCase();
  const order: AgentState[] = ['ok', 'unchecked', 'login', 'error', 'missing'];
  const shown = rows
    .filter(a => tab === 'all' || TAB_OF[agentState(a)] === tab)
    .filter(a => matches(needle, a.name, a.backend, a.description))
    .sort((a, b) => order.indexOf(agentState(a)) - order.indexOf(agentState(b)) || a.name.localeCompare(b.name));
  // 内置 Lom 和其他 Agent 用同一套搜索规则（UI-09）
  const showLom = (tab === 'all' || tab === 'ok') && matches(needle, LOM_NAME, '麓鸣', LOM_DESC);
  const nothing = !!needle && !showLom && !shown.length && !!s.agentCatalog;
  return <>
    <PageHead title="Agents" desc="管理本机可用的 AI 编程 Agent。Lom 是内置的总指挥，无需安装；其他 Agent 需要先在本机安装对应的 CLI 才能被识别。加到切换器后，可以在左上角切换新任务使用的 Agent。"
      actions={<Btn label="添加自定义 Agent" ic="plus" variant="primary" onClick={addCustomAgent} disabled={s.conn !== 'ready'} />} />
    <div className="row" style={{ gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
      <Seg options={[{ value: 'all', label: `全部 ${rows.length + 1}` }, { value: 'ok', label: `可用 ${count('ok') + 1}` }, { value: 'todo', label: `待处理 ${count('todo')}` }, { value: 'missing', label: `未安装 ${count('missing')}` }]} value={tab} onChange={v => setTab(v as Tab)} />
      <div className="grow" />
      <input className="input agent-search" placeholder="搜索 Agent…" value={q} onChange={e => setQ(e.target.value)} aria-label="搜索 Agent" />
      <Btn label="重新检测" ic="refresh" variant="secondary" size="sm" onClick={() => void loadAgents()} disabled={s.conn !== 'ready'} />
    </div>
    {tab === 'todo' && <p className="muted" style={{ marginBottom: 10 }}>待处理包括尚未检测、需要登录和启动异常的 Agent。</p>}
    {s.agentsError && <p className="form-error" style={{ marginBottom: 10 }}>{s.agentsError}</p>}
    <div className="list">
      {showLom && (
        <ListRow lead={<span className="agent-logo"><img src="/logo.png" alt="" /></span>} title={LOM_NAME} titleExtra={<Badge text="内置 · 可用" tone="ok" />}
          sub={LOM_DESC} actions={<Badge text="始终在切换器" />} />
      )}
      {s.conn !== 'ready' && <div className="list-row muted">核心服务未连接，无法检测本机 Agent</div>}
      {s.conn === 'ready' && !s.agentCatalog && <div className="list-row muted">正在检测本机 Agent…</div>}
      {nothing && <div className="list-row muted" role="status"><span className="grow">没有找到与「{q.trim()}」匹配的 Agent</span><Btn label="清空搜索" variant="link" size="sm" onClick={() => setQ('')} /></div>}
      {shown.map(a => {
        const st = STATE_BADGE[agentState(a)], pinned = s.agentPins.includes(a.id), testing = isTesting(a.id);
        return (
          <ListRow key={a.id} lead={<Logo src={a.icon} />} title={a.name} titleExtra={<Badge text={st.text} tone={st.tone} />}
            sub={<Diagnosis a={a} />}
            actions={<>
              <Btn label={testing ? '测试中…' : '测试连接'} variant="secondary" size="sm" onClick={() => void checkAgent(a.id)} disabled={testing || !a.installed} />
              {pinned
                ? <Btn label="从切换器移除" variant="ghost" size="sm" onClick={() => unpinAgent(a.id)} />
                : <Btn label="加到切换器" variant="secondary" size="sm" onClick={() => pinAgent(a.id)} disabled={!canPin(a)} />}
            </>} />
        );
      })}
    </div>
  </>;
}
