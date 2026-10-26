import { expect, it } from 'vitest';
import { sameFeishuScope } from './feishu';
it('FEISHU-MULTI rejects another assistant, bot or connection generation', () => {
  const scope = { account: 'owner', assistantId: 'a', appId: 'bot-a', generation: 2 };
  expect(sameFeishuScope(scope, { account: 'owner', assistant_id: 'a', app_id: 'bot-a', generation: 2 })).toBe(true);
  for (const change of [{ assistant_id: 'b' }, { app_id: 'bot-b' }, { generation: 1 }, { account: 'other' }])
    expect(sameFeishuScope(scope, { account: 'owner', assistant_id: 'a', app_id: 'bot-a', generation: 2, ...change })).toBe(false);
});
