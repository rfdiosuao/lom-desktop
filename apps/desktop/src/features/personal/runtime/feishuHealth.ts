import { update } from '@/state/store';
import type { FeishuScope } from './feishu';

type Listener = 'unknown' | 'starting' | 'running' | 'stopped' | 'error';
type Stage = 'received' | 'routed' | 'replied' | 'route_failed' | 'reply_failed';
export interface FeishuHealth {
  listener: Listener; diagnosticId?: string; generation?: number; appId?: string;
  received?: number; routed?: number; replied?: number; error?: string;
}
const health = new Map<string, FeishuHealth>();
const key = (account: string, assistant: string) => JSON.stringify([account, assistant]);
export const readFeishuHealth = (account: string, assistant: string): FeishuHealth => health.get(key(account, assistant)) || { listener: 'unknown' };
export function beginFeishuHealth(scope: FeishuScope, listener: Listener) {
  health.set(key(scope.account, scope.assistantId), { listener, diagnosticId: crypto.randomUUID().slice(0, 8), generation: scope.generation, appId: scope.appId, error: listener === 'error' ? 'feishu.listener_failed' : undefined });
  update(() => {});
}
export function markFeishuHealth(scope: FeishuScope, stage: Stage | Listener) {
  const h = readFeishuHealth(scope.account, scope.assistantId);
  if (h.generation !== scope.generation || h.appId !== scope.appId) return;
  if (stage.endsWith('_failed')) h.error = `feishu.${stage}`;
  else if (stage === 'received' || stage === 'routed' || stage === 'replied') { h[stage] = Date.now(); h.error = undefined; }
  else { h.listener = stage as Listener; h.error = stage === 'error' ? 'feishu.listener_failed' : undefined; }
  update(() => {});
}
