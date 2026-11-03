import { convOfKey } from '@/features/teams/runtime/team';
import { S, update } from '@/state/store';
import { choiceName, modeOption, setConvOption } from './agentOptions';
import { toast, toastError } from '@/shared/overlays/controller';
import type { MenuItem } from '@/shared/ui/Overlay';

/** Only live session options describe an external runner's current mode. */
export function externalPermission(ckey: string) {
  const c = convOfKey(ckey);
  const option = c?.agentId ? modeOption(S.agentOptions[c.id]) : undefined;
  const current = choiceName(option, option?.current_value);
  const change = c?.agentModeChange;
  const label = change ? `${current || '权限未知'} · ${change.confirmation === 'pending_next_turn' ? '下轮待生效' : '结果待核实'}` : current || '权限未确认';
  return { c, option, current, label };
}

export async function pickExternalPermission(ckey: string, value: string) {
  const { c, option } = externalPermission(ckey);
  if (!c?.agentId || !option?.options.some(o => o.value === value)) return;
  try {
    const result = await setConvOption(c, option.id, value);
    update(() => {
      if (result === 'observed') delete c.agentModeChange;
      else c.agentModeChange = { value, confirmation: result === 'next_turn' || result === 'pending_next_turn' ? 'pending_next_turn' : 'command_ack' };
    });
    const name = choiceName(option, value);
    if (result === 'observed') toast(`Agent 权限已生效：${name}`);
    else toast(result === 'next_turn' || result === 'pending_next_turn' ? `Agent 权限请求已提交，下一轮待生效：${name}` : `Agent 权限请求已提交，结果待核实：${name}`, 'info');
  } catch (e) { toastError('切换 Agent 权限失败', e); }
}

export function externalPermissionMenu(ckey: string): MenuItem[] {
  const { c, option, label } = externalPermission(ckey);
  return [
    { header: true, label: `${c?.agentName || 'Agent'} 的会话权限 · ${label}` },
    ...(option?.options.length ? option.options.map(o => ({ label: o.name || o.value, desc: o.description, select: 'single' as const,
      checked: option.current_value === o.value, onSelect: () => void pickExternalPermission(ckey, o.value) }))
      : [{ label: '尚未读取到会话权限选项', desc: '无法确认 Agent 实际权限；不会使用总指挥权限代替', disabled: true, onSelect: () => {} }]),
  ];
}
