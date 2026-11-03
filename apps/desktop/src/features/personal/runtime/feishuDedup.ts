import type { FeishuScope } from './feishu';
import { clearChannelHistory, reserveChannelMessage } from './channelDedup';

/* 飞书消息去重：规则由 channelDedup 统一维护（REFACTOR-01 模块 5），这里保留原有名称。
 * Only identifiers, never payloads; native generation is deliberately not a key. */
export function reserveFeishuMessage(scope: FeishuScope, messageId: string, current: () => boolean) {
  return reserveChannelMessage('feishu', [scope.account, scope.assistantId, scope.appId], messageId, current);
}
export function clearFeishuMessageHistory() { clearChannelHistory('feishu'); }
