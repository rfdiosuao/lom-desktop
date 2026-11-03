import { useState } from 'react';
import { PersonalMcp } from '@/features/personal/ui/PersonalMcp';
import { loadAssistants, storeAssistant } from '@/features/personal/runtime/catalog';
import { useStore } from '@/state/store';
import { Btn } from '@/shared/ui/Button';
import { openPersonalPanel } from '@/features/personal/runtime/panel';
export function PluginAssignments() {
  const s = useStore(), [selected, setSelected] = useState(''), [actionError, setActionError] = useState('');
  let assistants: ReturnType<typeof loadAssistants>['items'] = [], error = '';
  if (s.cloud === 'signed-in') { try { assistants = loadAssistants().items; } catch (e) { error = e instanceof Error ? e.message : '助理列表读取失败'; } }
  const assistant = assistants.find(a => a.id === selected);
  return <><h2>工具连接</h2><p className="muted">添加、测试和管理 MCP 服务。普通 Agent 在新任务中使用服务；Personal Agent 可在下方单独选择。</p>
    <h2>Personal Agent 的可用服务</h2>{(error || actionError) && <p role="alert">{error || actionError}</p>}
    {assistants.length ? <label>选择助理<select className="input" value={selected} onChange={e => setSelected(e.target.value)}><option value="">请选择</option>{assistants.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label> : <p>登录并创建 Personal Agent 后，可以在这里分配连接器。</p>}
    {assistant && <PersonalMcp key={assistant.id} assistant={assistant} />}
    <Btn label="打开 Personal Agent" onClick={() => {try {if (assistant) storeAssistant(assistant);openPersonalPanel();} catch(e) {setActionError(e instanceof Error ? e.message : '无法打开助理');}}} />
  </>;
}
