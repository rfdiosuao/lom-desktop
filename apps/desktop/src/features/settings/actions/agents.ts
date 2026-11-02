import { agentRow, loadAgents, testAgent, usable } from '../runtime/agents';
import { cachedOptions, modelOption, probeAgentOptions } from '../runtime/agentOptions';
import { conv } from '@/state/selectors';
import { S, update } from '@/state/store';
import { newTask, openSettings } from '@/app/navigation';
import { closeModal, openModal, toast, toastError } from '@/shared/overlays/controller';
import { api } from '@/core/client';

/* ===== Agent 切换器与「设置 → Agents」的操作 ===== */

/** 选 Agent：之后新建的任务用它。正在看的已有任务不会换 Agent，所以回到新任务页 */
export function pickAgent(id: string) {
  const a = agentRow(id);
  if (id && !usable(a)) { toast(`${a?.name ?? '这个 Agent'} 现在不可用，请先测试连接`, 'info'); openSettings('agents'); return; }
  update(s => { s.agentPick = id; s.menu = null; });
  // 第一次选这个 Agent：读一次它的模型列表，输入框右下角才能显示和切换
  if (a && !modelOption(cachedOptions(a.id))) void probeAgentOptions(a);
  const c = S.route.name === 'chat' ? conv(S.activeConv) : undefined;
  if (c && (c.agentId || '') !== id) newTask();
}

export const addAgents = () => { void loadAgents(); openSettings('agents'); };

export function pinAgent(id: string) {
  update(s => { if (!s.agentPins.includes(id)) s.agentPins.push(id); });
  toast(`已加到 Agent 切换器（左上角）`, 'check');
}

export function unpinAgent(id: string) {
  update(s => { s.agentPins = s.agentPins.filter(x => x !== id); if (s.agentPick === id) s.agentPick = ''; });
}

const testing = new Set<string>();
export async function checkAgent(id: string) {
  if (testing.has(id)) return;
  testing.add(id);
  update();
  try {
    const row = await testAgent(id);
    if (usable(row)) toast(`${row.name} 连接正常${row.last_check_latency_ms != null ? `（${row.last_check_latency_ms} 毫秒）` : ''}`, 'check');
    else toast(`${row.name} 不可用：${row.last_check_error_message || (row.installed ? '启动失败' : '本机还没有安装')}`, 'info');
  } catch (e) { toastError('测试连接失败', e); }
  finally { testing.delete(id); update(); }
}
export const isTesting = (id: string) => testing.has(id);

/* ---------- 自定义 Agent ---------- */
export const addCustomAgent = () => { S.form = { name: '', command: '', args: '', env: '', saving: false, error: '' }; openModal('customAgent'); };

function envOf(text: string) {
  const out: { name: string; value: string }[] = [];
  for (const line of text.split('\n').map(l => l.trim()).filter(Boolean)) {
    const i = line.indexOf('=');
    if (i < 1) throw new Error(`环境变量格式不对：${line.slice(0, 40)}（应为 KEY=VALUE）`);
    out.push({ name: line.slice(0, i).trim(), value: line.slice(i + 1) });
  }
  return out;
}

export async function saveCustomAgent() {
  const f = S.form;
  update(() => { f.saving = true; f.error = ''; });
  try {
    const env = envOf(String(f.env || ''));
    const command = String(f.command).trim(), args = String(f.args || '').split(/\s+/).filter(Boolean);
    const probe = await api<{ step: string; error?: string }>('POST', '/api/agents/custom/try-connect',
      { command, acp_args: args, env: Object.fromEntries(env.map(e => [e.name, e.value])) });
    if (probe.step !== 'success') throw new Error(probe.step === 'fail_auth' ? `能启动，但需要先在终端里登录：${probe.error || ''}` : probe.error || '无法启动这个 Agent');
    const row = await api<{ id: string; name: string }>('POST', '/api/agents/custom', { name: String(f.name).trim(), command, args, env });
    closeModal();
    await loadAgents();
    pinAgent(row.id);
  } catch (e) {
    update(() => { f.saving = false; f.error = e instanceof Error ? e.message : String(e); });
  }
}
