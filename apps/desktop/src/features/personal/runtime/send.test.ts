import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { api } from '@/core/client';
import { sendToTask } from '@/features/chat/runtime/tasks';
import { ensureLomSelection } from '@/features/account/runtime/cloud';
import { ensureTaskModel } from '@/features/chat/runtime/taskModel';
import { ensureTaskPermissions } from '@/features/settings/runtime/preferences';
import { beginAuthChange } from '@/features/account/runtime/authScope';
vi.mock('@/features/phones/runtime/phoneCommander', async load => ({ ...await load<typeof import('@/features/phones/runtime/phoneCommander')>(), ensurePersonalBridge: vi.fn(async () => {}), personalExtra: vi.fn(async () => ({ lom_personal_scope: 'pa-test', selected_mcp_server_ids: ['mcp_bridge'] })) }));
vi.mock('@/core/client', async load => ({ ...await load<typeof import('@/core/client')>(), api: vi.fn() }));
vi.mock('@/features/account/runtime/cloud', () => ({ ensureLomSelection: vi.fn(async () => {}) }));
vi.mock('@/features/chat/runtime/taskModel', async load => ({ ...await load<typeof import('@/features/chat/runtime/taskModel')>(), ensureTaskModel: vi.fn(async () => {}) }));
vi.mock('@/features/settings/runtime/preferences', async load => ({ ...await load<typeof import('@/features/settings/runtime/preferences')>(), ensureTaskPermissions: vi.fn(async () => {}) }));
vi.mock('./memory', async load => ({ ...await load<typeof import('./memory')>(), readDocument: vi.fn(async () => 'memory') }));
beforeEach(() => {
  vi.clearAllMocks(); S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' }; S.running = {}; S.teams = [];
  S.providers = [{ id: 'cloud', name: 'Lom 云端', enabled: true, models: ['pro'] } as any]; S.cloudModels = { pro: 'pro', max: 'max', mini: 'mini' };
  S.convs = [{ id: crypto.randomUUID(), owner: 'pc', title: '小麓', updated: 1, remote: true, messages: [], modelId: 'cloud::pro', personal: { id: 'pa_a', name: '小麓', directory: '/a' } }];
  localStorage.setItem('lom.personal.v1:owner', JSON.stringify({ items: [{ id: 'pa_a', name: '小麓', directory: '/a', workspace: '/a', conversation: S.convs[0].id }] }));
  vi.mocked(api).mockResolvedValue({ turn_id: 'turn' });
});
it.each(['selection', 'model', 'permissions'])('PA02 cancels send after account changes during %s preflight', async stage => {
  const step = stage === 'selection' ? ensureLomSelection : stage === 'model' ? ensureTaskModel : ensureTaskPermissions;
  let release!: () => void; vi.mocked(step).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }) as never);
  const sending = sendToTask(S.convs[0], 'private message', []);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  beginAuthChange(); S.account = { id: 'new-owner', name: '', email: '' }; S.convs = []; S.running = {};
  release(); expect(await sending).toBe(false);
  expect(vi.mocked(api).mock.calls.some(x => x[0] === 'POST' && x[1].endsWith('/messages'))).toBe(false);
  expect(S.running).toEqual({}); expect(S.convs).toEqual([]);
});
it('PA02 switching account mid-send leaves no endless spinner on the assistant conversation', async () => {
  const c = S.convs[0];
  // 真实的账号切换不清空本机会话列表：切回原账号时这条会话还在
  vi.mocked(api).mockImplementationOnce(async () => { beginAuthChange(); S.account = { id: 'new-owner', name: '', email: '' }; return { turn_id: 'old-turn' } as never; });
  expect(await sendToTask(c, 'private message', [])).toBe(false);
  expect(S.running[c.id]).toBeFalsy();
  expect(c.messages.find(m => m.type === 'user')?.status).toBe('unconfirmed');
  expect(c.messages.some(m => m.type === 'system')).toBe(false);
});
it('PA02 late send receipts never update the newly authenticated account state', async () => {
  vi.mocked(api).mockImplementationOnce(async () => { beginAuthChange(); S.account = { id: 'new-owner', name: '', email: '' }; S.convs = []; S.running = {}; return { turn_id: 'old-turn' } as never; });
  expect(await sendToTask(S.convs[0], 'private message', [])).toBe(false);
  expect(S.running).toEqual({}); expect(S.convs).toEqual([]);
});

it('PA-IDENTITY the real send path brands existing Personal sessions and keeps visible text unchanged', async () => {
  const c = S.convs[0];
  expect(await sendToTask(c, '你是谁？', [])).toBe(true);
  const sent = vi.mocked(api).mock.calls.find(x=>x[0]==='POST'&&x[1].endsWith('/messages'))?.[2] as any;
  expect(sent.content).toContain('[LOM_PERSONAL_IDENTITY_V1]');
  expect(sent.content).toContain('麓鸣 Lom');
  const { stripSettingsContext } = await import('@/features/settings/runtime/preferences');
  expect(stripSettingsContext(sent.content)).toBe('你是谁？');
  expect(S.convs[0].id).toBe(c.id);
  expect(c.messages.find(m=>m.type==='user')?.text).toBe('你是谁？');
});
it('PA04 channel dispatch with an invalid parent guard never appends or posts a message', async () => {
  const { sendFromChannel } = await import('@/features/chat/runtime/tasks');
  const c = S.convs[0];
  expect(await sendFromChannel(c, 'guarded dispatch', 'personal', () => false)).toBeNull();
  expect(c.messages).toEqual([]);expect(api).not.toHaveBeenCalled();
});
it('PA04 invalidation during memory preparation prevents the final message POST', async () => {
  const { readDocument } = await import('./memory');
  const { sendFromChannel } = await import('@/features/chat/runtime/tasks');
  let current = true;
  vi.mocked(readDocument).mockImplementationOnce(async () => { current = false; return 'memory'; });
  expect(await sendFromChannel(S.convs[0], 'guarded dispatch', 'personal', () => current)).toBeNull();
  expect(vi.mocked(api).mock.calls.some(x => x[0] === 'POST' && x[1].endsWith('/messages'))).toBe(false);
});
