import { useState, type ReactNode } from 'react';
import { useStore } from '@/state/store';
import { Btn } from '@/shared/ui/Button';
import type { FeishuStatus } from '../runtime/feishu';
import { readFeishuHealth } from '../runtime/feishuHealth';

/** UI-AUDIT-03：监听与消息记录各说一次，操作按钮同一行，脱敏诊断折叠放最后；`children` 是同一行的其他操作 */
export function FeishuHealthStatus({ account, assistantId, status, retry, children }: {
  account: string; assistantId: string; status: FeishuStatus; retry: () => Promise<void>; children?: ReactNode;
}) {
  useStore();
  const [busy, setBusy] = useState(false);
  const h = readFeishuHealth(account, assistantId);
  const scoped = h.appId === status.app_id && ((h.generation ?? -1) >= status.generation || (h.listener === 'error' && status.listener_running === false));
  const state = scoped ? h.listener : status.listener_running ? 'running' : 'unknown';
  const label = state === 'running' ? '监听进程运行' : state === 'starting' ? '正在重新连接' : state === 'error' ? '监听中断，等待重试' : '监听未运行';
  const stamp = (at?: number) => at ? new Date(at).toLocaleTimeString() : '尚无记录';
  const observed = scoped && h.received;
  return <>
    <p className="pa-muted">{label} · {observed ? `最近接收 ${stamp(h.received)} · 路由 ${stamp(h.routed)} · 回传 ${stamp(h.replied)}` : '消息收发尚未验证'}</p>
    {!observed && <p className="pa-muted">进程运行不代表消息收发正常。在飞书私聊机器人发一条消息后，这里会显示接收、路由和回传时间。</p>}
    {scoped && h.error && <p className="pa-error" role="alert">{h.error} · 请重新连接；若仍失败，请检查网络和飞书应用订阅设置。</p>}
    <div className="pa-channel__actions">
      <Btn label={busy ? '正在重新连接…' : '重新连接'} variant="ghost" size="sm" disabled={busy} onClick={() => { setBusy(true); void retry().finally(() => setBusy(false)); }} />
      {children}
    </div>
    <details className="pa-diagnostics"><summary>诊断信息（已脱敏）</summary><p className="pa-muted">诊断 ID：FEISHU-HEALTH-01/{scoped ? h.diagnosticId : '未观测'}/{scoped ? h.generation : status.generation} · 配置：{status.configured ? '有' : '无'} · 用户授权：{status.authorized ? '已授权' : '未授权'} · {label}</p></details>
  </>;
}
