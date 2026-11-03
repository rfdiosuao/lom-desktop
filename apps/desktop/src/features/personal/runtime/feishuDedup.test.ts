import { beforeEach, expect, it } from 'vitest';
import { reserveFeishuMessage, clearFeishuMessageHistory } from './feishuDedup';
const claimFeishuMessage = (scope: Parameters<typeof reserveFeishuMessage>[0], id: string) => {
  const ticket = reserveFeishuMessage(scope, id, () => true); ticket?.dispatched(); return !!ticket;
};
const scope = { account: 'owner', assistantId: 'assistant', appId: 'bot', generation: 1 };
beforeEach(clearFeishuMessageHistory);
it('FEISHU-HEALTH-02 identifiers survive generation changes without crossing owners assistants or bots', () => {
  expect(claimFeishuMessage(scope, 'same')).toBe(true);
  expect(claimFeishuMessage({ ...scope, generation: 2 }, 'same')).toBe(false);
  for (const changed of [{ account: 'other' }, { assistantId: 'other' }, { appId: 'other' }]) {
    expect(claimFeishuMessage({ ...scope, ...changed }, 'same')).toBe(true);
  }
});
it('FEISHU-HEALTH-02 auth invalidation retires identifiers', () => {
  claimFeishuMessage(scope, 'same'); clearFeishuMessageHistory();
  expect(claimFeishuMessage(scope, 'same')).toBe(true);
});
it('FEISHU-HEALTH-02 the recent window is bounded without dropping newer identifiers', () => {
  for (let i = 0; i <= 500; i++) expect(claimFeishuMessage(scope, `m${i}`)).toBe(true);
  expect(claimFeishuMessage(scope, 'm500')).toBe(false);
  expect(claimFeishuMessage(scope, 'm0')).toBe(true);
});
it('FEISHU-HEALTH-02 stale unsent ownership can be replaced without old cleanup deleting the new dispatch', () => {
  let current = true;
  const old = reserveFeishuMessage(scope, 'same', () => current)!;
  expect(reserveFeishuMessage(scope, 'same', () => true)).toBeNull();
  current = false;
  const replacement = reserveFeishuMessage({ ...scope, generation: 2 }, 'same', () => true)!;
  old.releaseUnsent(); replacement.dispatched(); replacement.releaseUnsent();
  expect(reserveFeishuMessage(scope, 'same', () => true)).toBeNull();
});
