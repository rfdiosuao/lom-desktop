import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';
const mock = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn(), toastError: vi.fn() }));
vi.mock('@/core/client', () => ({ api: mock.api, getEndpoint: () => undefined }));
vi.mock('@/shared/overlays/controller', () => ({ toast: mock.toast, toastError: mock.toastError }));
import { loadConvOptions } from './agentOptions';
import { externalPermission, externalPermissionMenu, pickExternalPermission } from './agentPermission';
const options = (value = 'default') => [{ id: 'session_mode', category: 'mode', current_value: value, options: [{ value: 'default', name: 'Default' }, { value: 'bypass', name: 'Full access' }] }];
beforeEach(() => {
  vi.clearAllMocks(); S.permission = 'full'; S.agentOptions = {}; S.teams = [];
  S.convs = [{ id: 'worker', owner: 'pc', agentId: 'qoder', agentName: 'Qoder', messages: [] } as unknown as Conv];
});
it('ACP-PERM external session labels use live mode and never global full access', () => {
  expect(externalPermission('conv:worker').label).toBe('权限未确认');
  S.agentOptions.worker = options();
  expect(externalPermission('conv:worker').label).toBe('Default');
  expect(externalPermissionMenu('conv:worker').some(item => typeof item !== 'string' && item.label === 'Full access')).toBe(true);
});
it.each(['command_ack', 'pending_next_turn', 'next_turn'])('ACP-PERM %s does not display requested mode as applied', async confirmation => {
  S.agentOptions.worker = options(); mock.api.mockResolvedValue({ confirmation, config_options: options('bypass') });
  await pickExternalPermission('conv:worker', 'bypass');
  expect(S.agentOptions.worker[0].current_value).toBe('default');
  expect(externalPermission('conv:worker').label).toBe(`Default · ${confirmation === 'command_ack' ? '结果待核实' : '下轮待生效'}`);
  expect(mock.toast.mock.calls[0][0]).not.toContain('已生效'); expect(S.permission).toBe('full');
});
it('ACP-PERM observed echo alone applies live session mode without restarting or sending', async () => {
  S.agentOptions.worker = options(); mock.api.mockResolvedValue({ confirmation: 'observed', config_options: options('bypass') });
  await pickExternalPermission('conv:worker', 'bypass');
  expect(externalPermission('conv:worker').label).toBe('Full access');
  expect(mock.api).toHaveBeenCalledExactlyOnceWith('PUT', '/api/conversations/worker/config-options/session_mode', { value: 'bypass' });
  expect(mock.toast.mock.calls[0][0]).toContain('已生效');
});
it('ACP-PERM observed without matching echo stays unconfirmed', async () => {
  S.agentOptions.worker = options(); mock.api.mockResolvedValue({ confirmation: 'observed', config_options: [] });
  await pickExternalPermission('conv:worker', 'bypass');
  expect(externalPermission('conv:worker').label).toBe('Default · 结果待核实');
});
it('ACP-PERM team permission selection targets only its real member conversation', async () => {
  S.teams = [{ id: 'team', real: true, leaderConv: 'leader', memberConvs: { m: 'worker' }, members: [{ mid: 'm', agent: 'ag:qoder' }], core: { id: 'core-team', slots: { m: 'slot' } } }] as never;
  S.agentOptions.worker = options(); mock.api.mockResolvedValue({ confirmation: 'observed', config_options: options('bypass') });
  const item = externalPermissionMenu('team:team:m').find(item => typeof item !== 'string' && item.label === 'Full access');
  expect(item && typeof item !== 'string' && 'onSelect' in item).toBe(true);
  await pickExternalPermission('team:team:m', 'bypass');
  expect(mock.api).toHaveBeenCalledExactlyOnceWith('PUT', '/api/teams/core-team/conversations/worker/config-options/session_mode', { value: 'bypass' });
  expect(S.permission).toBe('full');
});
it('ACP-PERM failed mode update keeps live mode and reports the error', async () => {
  S.agentOptions.worker = options(); mock.api.mockRejectedValue(new Error('offline'));
  await pickExternalPermission('conv:worker', 'bypass');
  expect(externalPermission('conv:worker').label).toBe('Default');
  expect(mock.toastError).toHaveBeenCalledOnce(); expect(mock.toast).not.toHaveBeenCalled();
});

it('ACP-PERM pending-next mode clears only after a fresh team GET observes its requested value', async () => {
  const c = S.convs[0];
  S.teams = [{ id: 'team', real: true, leaderConv: 'leader', memberConvs: { m: 'worker' }, core: { id: 'core-team' } }] as never;
  S.agentOptions.worker = options();
  mock.api.mockResolvedValueOnce({ confirmation: 'pending_next_turn', config_options: options('bypass') });
  await pickExternalPermission('conv:worker', 'bypass');
  // Cached target snapshots alone must not confirm a pending request.
  S.agentOptions.worker = options('bypass');
  expect(externalPermission('conv:worker').label).toContain('下轮待生效');
  mock.api.mockResolvedValueOnce({ config_options: options() });
  await loadConvOptions(c);
  expect(externalPermission('conv:worker').label).toContain('下轮待生效');
  mock.api.mockResolvedValueOnce({ config_options: options('bypass') });
  await loadConvOptions(c);
  expect(mock.api).toHaveBeenLastCalledWith('GET', '/api/teams/core-team/conversations/worker/config-options');
  expect(c.agentModeChange).toBeUndefined();
  expect(externalPermission('conv:worker').label).toBe('Full access');
});
