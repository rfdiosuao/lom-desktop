import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api }));
import { S } from '@/state/store';
import { initialState } from '@/state/state';
import { answerConfirmation, onPermission } from '@/features/chat/runtime/stream';
import type { CoreConfirmation } from '@/core/types';
import type { Msg } from '@/state/types';

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); Object.assign(S, initialState()); m.api.mockResolvedValue({});
  S.convs = [{ id: 'core', remote: true, owner: 'pc', title: '', updated: 0, messages: [] }];
});
const request = (category?: string): CoreConfirmation => ({ id: 'confirm', call_id: 'tool', title: 'Read a file', description: 'harmless looking text', action: 'ExecCommand', options: [
  { label: 'Once', value: 'proceed_once' }, { label: 'Always', value: 'proceed_always' }, { label: 'No', value: 'cancel' },
], command_type: category });
const card = (): Msg => ({ id: 'm', at: 0, type: 'approval', status: 'pending', confirmId: 'confirm', callId: 'tool', confirmationEngine: 'embedded', confirmationOptions: [
  { label: 'Once', value: 'proceed_once', action: 'once' }, { label: 'Always', value: 'proceed_always', action: 'always' }, { label: 'No', value: 'cancel', action: 'deny' },
] });
it('deny allows only core-classified reads, never command text pretending to be a read', () => {
  S.prefs.allowInstall = 'deny';
  for (const category of ['exec', 'edit', undefined]) {
    S.convs[0].messages = [];
    onPermission(S.convs[0], request(category));
    expect(m.api).toHaveBeenLastCalledWith('POST', expect.any(String), { msg_id: 'confirm', data: { value: 'cancel' }, always_allow: false });
  }
  S.convs[0].messages = [];
  onPermission(S.convs[0], request('info'));
  expect(m.api).toHaveBeenLastCalledWith('POST', expect.any(String), { msg_id: 'confirm', data: { value: 'proceed_once' }, always_allow: false });
});
it('readonly rejects stale approval buttons and ask never creates an always grant', async () => {
  S.permission = 'readonly'; S.prefs.allowInstall = 'allow';
  await answerConfirmation(S.convs[0], card(), 'always');
  expect(m.api.mock.lastCall?.[2].data.value).toBe('cancel');
  S.permission = 'auto'; S.prefs.allowInstall = 'ask';
  await answerConfirmation(S.convs[0], card(), 'always');
  expect(m.api.mock.lastCall?.[2]).toEqual({ msg_id: 'confirm', data: { value: 'proceed_once' }, always_allow: false });
});
it('external CLI requests are not silently approved as embedded read tools', async () => {
  S.convs[0].agentId = 'external-cli'; S.convs[0].agentBackend = 'codex'; S.prefs.allowInstall = 'deny';
  onPermission(S.convs[0], { ...request('info'), options: [{ label: 'Once', value: 'allow' }, { label: 'Always', value: 'allow_always' }, { label: 'No', value: 'reject' }] });
  expect(m.api).not.toHaveBeenCalled(); expect(S.convs[0].messages[0].type).toBe('approval');
  await answerConfirmation(S.convs[0], S.convs[0].messages[0], 'always');
  expect(m.api.mock.lastCall?.[2].data.value).toBe('allow_always');
});

it('PA-PERM-01 native full access grants structured embedded confirmations once, without persistent grants', async () => {
  S.permission = 'full'; S.prefs.allowInstall = 'deny';
  onPermission(S.convs[0], request('exec'));
  await vi.waitFor(() => expect(S.convs[0].messages[0].status).toBe('approved'));
  expect(m.api).toHaveBeenLastCalledWith('POST', expect.any(String), { msg_id: 'confirm', data: { value: 'proceed_once' }, always_allow: false });
});
it.each(['side','external','personal'] as const)('PA-PERM-01 native full access cannot authorize %s conversations', async kind => {
  S.permission = 'full'; S.prefs.allowInstall = 'deny';
  const c = S.convs[0];
  if (kind === 'side') c.sideOf = 'parent';
  if (kind === 'external') { c.agentId = 'external'; c.agentBackend = 'codex'; }
  if (kind === 'personal') c.personal = { id: 'unowned', name: 'Other', directory: '/other' };
  onPermission(c, request('exec'));
  await Promise.resolve();
  expect(c.messages[0].status).not.toBe('approved');
});
