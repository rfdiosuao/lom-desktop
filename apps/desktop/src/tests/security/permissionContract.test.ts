import { beforeEach, expect, it, vi } from 'vitest';
import type { CoreConfirmation, CorePermissionRequest } from '@/core/types';
import type { Conv, Msg } from '@/state/types';
import { S } from '@/state/store';
const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', () => ({ api: mock.api, getEndpoint: () => null }));
vi.mock('@/features/workspace/runtime/workspace', () => ({ refreshWorkspace: vi.fn() }));
vi.mock('@/features/chat/runtime/taskSync', () => ({ refreshTaskList: vi.fn() }));
vi.mock('@/shared/overlays/controller', () => ({ toast: vi.fn(), toastError: vi.fn(), openModal: vi.fn() }));
import { handleCoreEvent } from '@/features/chat/runtime/stream';
import { approvePermission, approvePermissionOption, onPermission } from '@/features/chat/runtime/permissions';
import { restoreConfirmations } from '@/features/chat/runtime/tasks';

let c: Conv;
beforeEach(() => {
  mock.api.mockReset().mockResolvedValue({});
  c = { id: 'c', owner: 'pc', title: '', updated: 0, remote: true, agentId: 'external', agentBackend: 'codex', messages: [] };
  S.convs = [c]; S.permission = 'ask'; S.prefs.allowInstall = 'ask'; S.agentCatalog = []; S.teams = [];
});
const request = (): CorePermissionRequest => ({ session_id: 'c', tool_call: { tool_call_id: 'req/1', title: 'Bash', raw_input: { description: 'Run command' } }, options: [
  { option_id: 'allow', name: 'Allow', kind: 'allow_once' }, { option_id: 'allow_always', name: 'Always', kind: 'allow_always' }, { option_id: 'reject', name: 'Reject', kind: 'reject_once' },
] });
const recovery = (): CoreConfirmation => ({ id: 'req/1', call_id: 'req/1', title: 'Bash', description: 'Run command', options: request().options.map(o => ({ label: o.name, value: o.option_id })) });
const card = () => c.messages.find(m => m.type === 'approval')!;

it.each([['deny', 'reject', false], ['once', 'allow', false], ['always', 'allow_always', true]] as const)(
  'D26 live nested session permission %s sends its offered option, never embedded aliases', async (action, value, always) => {
    handleCoreEvent({ name: 'message.stream', data: { conversation_id: 'c', msg_id: 'm', type: 'acp_permission', data: request() as unknown as Record<string, unknown> } });
    expect(card()).toMatchObject({ confirmId: 'req/1', callId: 'req/1', command: 'Run command', status: 'pending' });
    await approvePermission(c, card(), action);
    expect(mock.api).toHaveBeenCalledWith('POST', '/api/conversations/c/confirmations/req%2F1/confirm', { msg_id: 'req/1', data: { value }, always_allow: always });
    expect(card().status).toBe(action === 'deny' ? 'denied' : 'approved');
  });

it('D26 recovered session reject sends reject and same-client remove does not turn it into allow', async () => {
  restoreConfirmations(c, [recovery()]);
  mock.api.mockImplementation(async () => { handleCoreEvent({ name: 'confirmation.remove', data: { conversation_id: 'c', id: 'req/1' } }); });
  await approvePermission(c, card(), 'deny');
  expect(mock.api.mock.lastCall?.[2]).toEqual({ msg_id: 'req/1', data: { value: 'reject' }, always_allow: false });
  expect(card().status).toBe('denied');
});

it('D26 cross-client removal marks outcome unknown instead of claiming approval', () => {
  onPermission(c, recovery());
  handleCoreEvent({ name: 'confirmation.remove', data: { conversation_id: 'c', id: 'req/1' } });
  expect(card().status).toBe('resolved');
  expect(mock.api).not.toHaveBeenCalled();
});

it.each([
  { options: [{ option_id: 'cancel', name: 'Reject', kind: 'reject_once' }] },
  { options: [{ option_id: 'reject', name: 'Reject', kind: 'allow_once' }] },
  { options: [{ option_id: 'allow', name: 'Allow', kind: 'invented' }] },
  { options: [] },
])('D26 unknown or contradictory session options fail closed: $options', async override => {
  onPermission(c, { ...request(), ...override } as CorePermissionRequest);
  for (const action of ['deny', 'once', 'always'] as const) await approvePermission(c, card(), action);
  expect(mock.api).not.toHaveBeenCalled(); expect(card().status).toBe('pending');
});

it('D26 malformed IDs and object option values never reach confirmation API', async () => {
  onPermission(c, { ...recovery(), options: [{ label: 'Reject', value: { value: 'reject' } }] });
  await approvePermission(c, card(), 'deny');
  onPermission(c, { tool_call: {}, options: request().options });
  expect(mock.api).not.toHaveBeenCalled(); expect(c.messages.at(-1)?.text).toContain('数据不完整');
});

it('D26 known ACP backend honors an explicit custom reject ID; missing backend fails closed', async () => {
  const d = { ...request(), options: [{ option_id: 'no_thanks', name: 'Reject', kind: 'reject_once' as const }] };
  c.agentBackend = 'qwen'; onPermission(c, d); await approvePermission(c, card(), 'deny');
  expect(mock.api.mock.lastCall?.[2]).toEqual({ msg_id: 'req/1', data: { value: 'no_thanks' }, always_allow: false });
  mock.api.mockClear(); c.messages = []; c.agentBackend = undefined;
  onPermission(c, d); await approvePermission(c, card(), 'deny'); expect(mock.api).not.toHaveBeenCalled();
});

it('D26 recovered proven-ACP custom options submit the exact choice without inventing its meaning', async () => {
  c.agentBackend = 'qwen'; onPermission(c, { ...recovery(), options: [{ label: 'No thanks', value: 'custom_reject' }] });
  await approvePermission(c, card(), 'once'); expect(mock.api).not.toHaveBeenCalled();
  await approvePermissionOption(c.id, card(), 'not_offered'); expect(mock.api).not.toHaveBeenCalled();
  await approvePermissionOption(c.id, card(), 'custom_reject');
  expect(mock.api.mock.lastCall?.[2]).toEqual({ msg_id: 'req/1', data: { value: 'custom_reject' }, always_allow: false });
  expect(card().status).toBe('resolved'); expect(card().confirmationSubmitted).toBe(true);
});

it('D26 missing backend cannot infer meanings from session-looking recovered ACP option IDs', async () => {
  c.agentBackend = undefined;
  onPermission(c, { ...recovery(), options: [{ label: 'Allow this tool', value: 'reject' }] });
  await approvePermission(c, card(), 'deny'); await approvePermissionOption(c.id, card(), 'reject');
  expect(mock.api).not.toHaveBeenCalled(); expect(card().status).toBe('pending');
});

it('D26 mutable catalog cannot replace the actual conversation engine or prove a missing backend', async () => {
  S.agentCatalog = [{ id: 'external', name: 'Renamed', backend: 'qwen', enabled: true, installed: true, status: 'online', agent_type: 'acp', agent_source: 'custom' }];
  c.agentBackend = 'claude';
  onPermission(c, { ...request(), options: [{ option_id: 'custom_reject', name: 'Reject', kind: 'reject_once' }] });
  await approvePermission(c, card(), 'deny'); expect(mock.api).not.toHaveBeenCalled();
  c.messages = []; c.agentBackend = undefined; S.agentCatalog[0].backend = 'claude'; onPermission(c, recovery());
  await approvePermission(c, card(), 'deny'); expect(mock.api).not.toHaveBeenCalled();
});

it.each([['qwen', 'claude', 'cancel'], ['claude', 'qwen', 'reject']])('D26 conflicting persisted %s and catalog %s backends cannot submit a recovered %s option', async (actual, catalog, value) => {
  c.agentBackend = actual;
  S.agentCatalog = [{ id: 'external', name: 'Changed', backend: catalog, enabled: true, installed: true, status: 'online', agent_type: 'acp', agent_source: 'custom' }];
  onPermission(c, { ...recovery(), options: [{ label: 'Reject', value }] });
  await approvePermission(c, card(), 'deny'); await approvePermissionOption(c.id, card(), value);
  expect(mock.api).not.toHaveBeenCalled(); expect(card().confirmationProblem).toContain('配置已变化');
});

it('D26 changing backend metadata after rendering a recovered ACP choice cannot submit a stale value', async () => {
  c.agentBackend = 'qwen'; onPermission(c, { ...recovery(), options: [{ label: 'Reject', value: 'cancel' }] });
  S.agentCatalog = [{ id: 'external', name: 'Changed', backend: 'claude', enabled: true, installed: true, status: 'online', agent_type: 'acp', agent_source: 'custom' }];
  await approvePermissionOption(c.id, card(), 'cancel'); expect(mock.api).not.toHaveBeenCalled();
});

it('D26 team tool names do not silently authorize external or embedded operations', () => {
  S.teams = [{ id: 't', name: '', folder: '', created: 0, members: [], panes: {}, core: { id: 'ct', slots: { c: 's' }, assistant: '' } }];
  onPermission(c, { ...recovery(), action: 'team_send_message', title: 'team_send_message' });
  expect(mock.api).not.toHaveBeenCalled(); expect(card().status).toBe('pending');
  c.messages = []; c.agentId = undefined; c.agentBackend = undefined;
  onPermission(c, { ...recovery(), action: 'team_send_message', options: [{ label: 'Once', value: 'proceed_once' }] });
  expect(mock.api).not.toHaveBeenCalled(); expect(card().status).toBe('pending');
});

it('D26 failed submission stays pending and duplicate clicks submit at most once', async () => {
  onPermission(c, request());
  let reject!: (e: Error) => void;
  mock.api.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  const first = approvePermission(c, card(), 'deny'); await approvePermission(c, card(), 'once');
  expect(mock.api).toHaveBeenCalledTimes(1); expect(card().status).toBe('submitting');
  reject(new Error('offline')); await first; expect(card().status).toBe('pending');
});

it('D26 detached stale permission cards cannot submit to a removed conversation', async () => {
  onPermission(c, request()); const m: Msg = card(); S.convs = [];
  await approvePermission(c, m, 'once'); expect(mock.api).not.toHaveBeenCalled();
});

it('D26 a late permission HTTP success cannot overwrite a verified cancellation', async () => {
  onPermission(c, request()); let resolve!: (value: unknown) => void;
  mock.api.mockImplementation(() => new Promise(done => { resolve = done; }));
  const pending = approvePermission(c, card(), 'once'); card().status = 'denied'; resolve({}); await pending;
  expect(card().status).toBe('denied'); expect(card().confirmationSubmitted).not.toBe(true);
});

it('SIDE-03 a side chat forces deny even when the caller requests allow', async () => {
  const side: Conv = { id: 'side', owner: 'pc', title: '', updated: 0, remote: true, agentId: 'external', agentBackend: 'qwen', sideOf: 'c', messages: [] };
  S.convs = [c, side];
  const m: Msg = { id: 'a', type: 'approval', at: 0, status: 'pending', confirmId: 'req/9', callId: 'req/9', confirmationEngine: 'acp',
    confirmationOptions: [{ value: 'allow', action: 'once', label: 'Allow' }, { value: 'reject', action: 'deny', label: 'Reject' }] };
  side.messages.push(m);
  await approvePermission(side, m, 'once');
  expect(mock.api).toHaveBeenCalledWith('POST', '/api/conversations/side/confirmations/req%2F9/confirm', { msg_id: 'req/9', data: { value: 'reject' }, always_allow: false });
  expect(m.status).toBe('denied');
});

it('SIDE-03 a side chat cannot submit an unknown recovered ACP allow choice', async () => {
  const side: Conv = { id: 'side', owner: 'pc', title: '', updated: 0, remote: true, agentId: 'external', agentBackend: 'qwen', sideOf: 'c', messages: [] };
  S.convs = [c, side];
  const m: Msg = { id: 'a', type: 'approval', at: 0, status: 'pending', confirmId: 'req/9', callId: 'req/9', confirmationEngine: 'acp',
    confirmationOptions: [{ value: 'allow', action: 'choice', label: 'Allow' }] };
  side.messages.push(m);
  await approvePermissionOption(side.id, m, 'allow');
  expect(mock.api).not.toHaveBeenCalled();
  expect(m.status).toBe('pending');
  expect(m.confirmationSubmitted).not.toBe(true);
});
