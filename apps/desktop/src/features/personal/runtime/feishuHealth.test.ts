import { expect, it } from 'vitest';
import { beginFeishuHealth, markFeishuHealth, readFeishuHealth } from './feishuHealth';
const scope = { account: 'health-owner', assistantId: 'a', appId: 'bot', generation: 1 };
it('FEISHU-HEALTH-01 stages are observed independently and stale generations cannot report success', () => {
  beginFeishuHealth(scope, 'starting');
  expect(readFeishuHealth(scope.account, 'a').received).toBeUndefined();
  markFeishuHealth(scope, 'received'); markFeishuHealth(scope, 'routed'); markFeishuHealth(scope, 'reply_failed');
  expect(readFeishuHealth(scope.account, 'a')).toMatchObject({ received: expect.any(Number), routed: expect.any(Number), error: 'feishu.reply_failed' });
  expect(readFeishuHealth(scope.account, 'a').replied).toBeUndefined();
  beginFeishuHealth({ ...scope, generation: 2 }, 'running'); markFeishuHealth(scope, 'replied');
  expect(readFeishuHealth(scope.account, 'a').replied).toBeUndefined();
  expect(readFeishuHealth(scope.account, 'b').listener).toBe('unknown');
});
