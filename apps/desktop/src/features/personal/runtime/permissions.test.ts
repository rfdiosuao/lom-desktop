import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { api } from '@/core/client';
import { onPermission, answerConfirmation } from '@/features/chat/runtime/permissions';
import type { Conv } from '@/state/types';
vi.mock('@/core/client', async load => ({ ...await load<typeof import('@/core/client')>(), api: vi.fn(async () => ({})) }));
let c: Conv;
const request = { id: 'confirmation', call_id: 'write', command_type: 'write', title: 'Write document', options: [{ value: 'cancel', label: '拒绝' }, { value: 'proceed_once', label: '允许一次' }] };
beforeEach(() => {
  vi.clearAllMocks(); S.permission = 'readonly'; S.prefs.allowInstall = 'ask';
  c = { id: 'pa', owner: 'pc', title: '小麓', updated: 1, remote: true, messages: [], personal: { id: 'pa_a', name: '小麓', directory: '/a' } };
  S.convs = [c];
});
it('PA02 keeps its write approval pending while the main workbench is read-only', async () => {
  onPermission(c, request);
  expect(c.messages[0].status).toBe('pending'); expect(api).not.toHaveBeenCalled();
  expect(await answerConfirmation(c, c.messages[0], 'once')).toBe('once');
  expect(api).toHaveBeenCalledWith('POST', '/api/conversations/pa/confirmations/write/confirm', { msg_id: 'confirmation', data: { value: 'proceed_once' }, always_allow: false });
  expect(S.permission).toBe('readonly');
});
it.each(['side', 'deny', 'main'])('PA02 preserves existing safety restriction: %s', async restriction => {
  if (restriction === 'side') c.sideOf = 'parent';
  if (restriction === 'deny') S.prefs.allowInstall = 'deny';
  if (restriction === 'main') delete c.personal;
  onPermission(c, request);
  await vi.waitFor(() => expect(api).toHaveBeenCalled());
  expect(await answerConfirmation(c, c.messages[0], 'once')).toBe('deny');
  expect(api).toHaveBeenLastCalledWith('POST', '/api/conversations/pa/confirmations/write/confirm', { msg_id: 'confirmation', data: { value: 'cancel' }, always_allow: false });
});
