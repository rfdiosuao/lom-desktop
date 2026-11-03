import { mcpStatusLabel } from '@/features/settings/runtime/mcpManager';
import { personalConfigUpdating } from '../runtime/configurationLock';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/state/store';
import { Btn } from '@/shared/ui/Button';
import { Spinner, Toggle } from '@/shared/ui/Controls';
import { openModal } from '@/shared/overlays/controller';
import { authAccount } from '@/features/account/runtime/authScope';
import { loadAssistants, type PersonalAssistant } from '../runtime/catalog';
import { readAssistantMcp, saveAssistantMcp, testAssistantMcp, type AssistantMcpSnapshot } from '../runtime/mcpBindings';

export function PersonalMcp({ assistant }: { assistant: PersonalAssistant }) {
  const s = useStore(), epoch = useRef(0);
  const [data, setData] = useState<AssistantMcpSnapshot>(), [selected, setSelected] = useState<string[]>([]);
  const [stage, setStage] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const owner = s.account?.id;
  const work = async (kind: string, run: () => Promise<{ data?: AssistantMcpSnapshot; notice?: string }>) => {
    const attempt = ++epoch.current, current = authAccount(); setStage(kind); setError(''); setNotice('');
    try {
      const result = await run();
      if (attempt !== epoch.current || !current()) return;
      if (result.data) { setData(result.data); setSelected(result.data.selected); }
      if (result.notice) setNotice(result.notice);
    } catch (e) { if (attempt === epoch.current && current()) setError(e instanceof Error ? e.message : 'MCP 操作失败'); }
    finally { if (attempt === epoch.current) setStage(''); }
  };
  const reload = () => work('正在读取服务…', async () => ({ data: await readAssistantMcp(assistant) }));
  useEffect(() => {
    setData(undefined); setSelected([]); setError(''); setNotice('');
    if (s.cloud === 'signed-in' && assistant.conversation) void reload();
    return () => { epoch.current++; };
  }, [owner, s.cloud, assistant.id, assistant.conversation]);
  let pending = false;
  try { pending = !!loadAssistants().items.find(a => a.id === assistant.id)?.mcpRefreshPending; }
  catch { /* Ownership is validated by every read/write; never authorize from display state. */ }
  const disabled = !!stage || personalConfigUpdating(assistant.conversation) || s.cloud !== 'signed-in' || !assistant.conversation;
  const running = !!s.running[assistant.conversation || ''];
  const save = () => work('正在更新服务…', async () => {
    await saveAssistantMcp(assistant, selected);
    return { data: await readAssistantMcp(assistant), notice: '服务选择已更新；连接可用性请单独测试。' };
  });
  return <section className="pa-section" aria-label="助理 MCP 服务">
    <h2>MCP 服务</h2>
    <p className="pa-muted">选择这条助理会话使用的外部服务，内部调度工具保留。操作仍遵守助理权限；不影响其他助理或独立定时任务。</p>
    {stage && <p className="pa-muted" role="status"><Spinner size={16} /> {stage}</p>}
    {error && <p className="pa-error" role="alert">{error}</p>}
    {notice && <p className="pa-muted" role="status">{notice}</p>}
    {pending && <p className="pa-error">上次更新未确认；重新读取、核对并保存后才能继续发送任务。</p>}
    {data?.missing.length ? <p className="pa-muted">有 {data.missing.length} 个服务已删除或不可配置，保存时会移除这些旧引用。</p> : null}
    {data?.servers.map(server => <div className="integration-panel" role="group" aria-label={server.name} key={server.id}>
      <div className="row"><Toggle label={`使用 ${server.name}`} on={selected.includes(server.id)} disabled={disabled || running} onChange={() => setSelected(ids => ids.includes(server.id) ? ids.filter(id => id !== server.id) : [...ids, server.id])} /><span>{server.name}</span></div>
      <p className="pa-muted">{server.enabled ? '新任务默认启用' : '非默认服务，可单独选择'} · 测试：{mcpStatusLabel(server.last_test_status)}</p>
      <Btn label="测试连接" title={`测试 ${server.name} 连接`} size="sm" disabled={disabled} onClick={() => void work('正在测试连接…', async () => ({ notice: await testAssistantMcp(assistant, server.id) }))} />
    </div>)}
    {data && !data.servers.length && <p className="pa-muted">尚未添加外部 MCP 服务，可先打开服务管理。</p>}
    {running && <p className="pa-muted">助理正在执行，结束后可保存服务选择。</p>}
    <div className="row"><Btn label="服务管理" size="sm" disabled={!!stage} onClick={() => openModal('mcp')} /><Btn label="重新读取" size="sm" disabled={disabled} onClick={() => void reload()} /><Btn label="保存服务选择" size="sm" disabled={disabled || running || !data} onClick={() => void save()} /></div>
  </section>;
}
