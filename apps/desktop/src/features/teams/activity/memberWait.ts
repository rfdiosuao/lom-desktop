import type { Conv } from '@/state/types';

/** Pending user actions outrank tool activity, even when a runner has become idle. */
export function memberWait(c: Conv | undefined, now = Date.now()) {
  const actions = c?.messages.filter(m => m.type === 'approval' || m.type === 'question') || [];
  const message = actions.find(m => m.status === 'pending' || m.status === 'submitting')
    ?? actions.find(m => m.status === 'unconfirmed');
  if (!message) return undefined;
  const submitting = message.status === 'submitting';
  const label = message.status === 'unconfirmed'
    ? (message.type === 'approval' ? '授权结果待核实' : '回答结果待核实')
    : message.type === 'approval' ? (submitting ? '正在提交授权' : '等待授权') : (submitting ? '正在提交回答' : '等待回答');
  return { message, label, tool: message.toolName || message.tool || message.command || '', seconds: Math.max(0, Math.floor((now - message.at) / 1000)) };
}

/** Runner idleness supplies no terminal task evidence. Keep unknown distinct from completed. */
export function memberRuntimeLabel(c: Conv | undefined, running: boolean) {
  return memberWait(c)?.label ?? (running ? '执行中' : '运行状态未知');
}
