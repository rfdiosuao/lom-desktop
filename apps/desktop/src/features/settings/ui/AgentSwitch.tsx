import { useEffect } from 'react';
import { openMenu } from '@/shared/overlays/controller';
import { Icon } from '@/shared/ui/Icon';
import { agentRow, loadAgents, logoUrl } from '../runtime/agents';
import { conv } from '@/state/selectors';
import { useStore } from '@/state/store';

/* ===== 中栏左上角的 Agent 切换器（替代原来的后退 / 前进）=====
 * 新任务页：选择接下来用哪个 Agent；已有任务：显示它的 Agent，切换会回到新任务页。手机模式不显示。 */

export function AgentSwitch() {
  const s = useStore();
  useEffect(() => { if (s.conn === 'ready' && !s.agentCatalog) void loadAgents(); }, [s.conn, s.agentCatalog]);
  const c = s.route.name === 'chat' ? conv(s.activeConv) : undefined;
  if (s.mode !== 'desktop' || s.route.name === 'settings' || (c && c.owner !== 'pc')) return null;
  const id = c ? c.agentId || '' : s.agentPick;
  const a = agentRow(id);
  const name = id ? a?.name || c?.agentName || '其他 Agent' : 'Lom';
  const logo = id ? logoUrl(a?.icon) : '/logo.png';
  return (
    <button type="button" className="agent-switch" aria-haspopup="menu" aria-label={`当前 Agent：${name}。点击切换`}
      onClick={e => openMenu('agentSwitch', e.currentTarget, { key: 'agsw' })}>
      {logo ? <img className="agent-switch__logo" src={logo} alt="" /> : <Icon name="cube" />}
      <span className="agent-switch__name">{name}</span>
      <Icon name="chevron" />
    </button>
  );
}
