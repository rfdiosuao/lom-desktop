import { beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { Conv } from '@/state/types';
const m = vi.hoisted(() => ({ invoke: vi.fn(), add: vi.fn(), load: vi.fn(), confirm: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
vi.mock('./catalog', () => ({ loadAssistants: m.load, addAssistant: m.add }));
vi.mock('@/shared/overlays/controller', () => ({ confirm: m.confirm }));
import { executeCapabilityTool } from './capabilityTools';
const self = { id: 'c', personal: { id: 'pa_a', name: 'A', directory: '/a' }, messages: [] } as unknown as Conv;
let count = 0;
const call = (name: string, args = {}, current = () => true, id = `tool-${++count}`) => executeCapabilityTool(self, { id, scope: 'pa-scope', name, arguments: JSON.stringify(args) }, current);
beforeEach(() => {
  vi.clearAllMocks(); S.cloud = 'signed-in'; S.account = { id: 'owner' } as typeof S.account;
  self.messages = [{ id: `user-${count}`, type: 'user', text: '以后回答简短一点', at: 1 }];
  S.convs = [self]; S.running = { c: true }; S.modals = [];
  m.load.mockReturnValue({ items: [{ id: 'pa_a', name: 'A', directory: '/a', conversation: 'c' }] });
  m.confirm.mockImplementation(p => { S.modals.push({ id: 'confirm', props: p }); });
  m.invoke.mockResolvedValue({ current_version: 2, versions: [] }); m.add.mockResolvedValue({ id: 'new', name: '阅读助理' });
});
it('PA-CAPABILITY-01 creation requires approval and same-id retry never duplicates', async () => {
  const pending = call('personal_assistant_create', { name: '阅读助理' }, () => true, 'create-once');
  await vi.waitFor(() => expect(m.confirm).toHaveBeenCalled()); expect(m.add).not.toHaveBeenCalled();
  m.confirm.mock.calls[0][0].onOk(); expect(await pending).toMatchObject({ isError: false });
  await call('personal_assistant_create', { name: '阅读助理' }, () => true, 'create-once'); expect(m.add).toHaveBeenCalledTimes(1);
});
it('PA-CAPABILITY-01 dismissal and stopped calls cannot mutate', async () => {
  const pending = call('personal_assistant_create', { name: 'Other' });
  await vi.waitFor(() => expect(m.confirm).toHaveBeenCalled()); update(s => { s.modals = []; });
  expect(await pending).toMatchObject({ isError: true }); expect(m.add).not.toHaveBeenCalled();
  expect(await call('personal_assistant_create', { name: 'Other' }, () => false)).toMatchObject({ isError: true });
});
it('PA-CAPABILITY-01 merge rejects fabricated source, unrestricted values and credentials', async () => {
  for (const args of [{ slot: 'length', value: 'concise', quote: 'fake' }, { slot: 'fact', value: 'secret', quote: '简短' }, { slot: 'length', value: 'concise', quote: '简短', user: 'fake' }]) expect(await call('personal_memory_merge', args)).toMatchObject({ isError: true });
  expect(m.confirm).not.toHaveBeenCalled();
});
it('PA-CAPABILITY-01 approved preference uses actual source and exact expected version', async () => {
  const pending = call('personal_memory_merge', { slot: 'length', value: 'concise', quote: '简短' });
  await vi.waitFor(() => expect(m.confirm).toHaveBeenCalled()); m.confirm.mock.calls[0][0].onOk(); await pending;
  expect(m.invoke).toHaveBeenCalledWith('personal_apply_learning', { request: expect.objectContaining({ user: '以后回答简短一点', expected_version: 2 }) });
});
it('PA-CAPABILITY-01 literal fact awaits approval before native mutation', async () => {
  self.messages = [{ id: 'fact-u', type: 'user', text: '我的猫叫小白', at: 1 }];
  const pending = call('personal_memory_merge', { slot: 'fact', value: '我的猫叫小白', quote: '我的猫叫小白' });
  await vi.waitFor(() => expect(m.confirm).toHaveBeenCalled()); expect(m.invoke.mock.calls.some(c => c[0] === 'personal_apply_learning')).toBe(false);
  m.confirm.mock.calls[0][0].onOk(); await pending;
  expect(m.invoke).toHaveBeenCalledWith('personal_apply_learning', { request: expect.objectContaining({ user: '我的猫叫小白', expected_version: 2 }) });
});
it('PA-CAPABILITY-01 rollback approves existing version with stale-version guard', async () => {
  m.invoke.mockResolvedValue({ current_version: 2, versions: [{ version: { number: 1 } }] });
  const pending = call('personal_memory_rollback', { version: 1 });
  await vi.waitFor(() => expect(m.confirm).toHaveBeenCalled()); m.confirm.mock.calls[0][0].onOk(); await pending;
  expect(m.invoke).toHaveBeenCalledWith('personal_memory_versions', { request: expect.objectContaining({ expected_version: 2, rollback: 1 }) });
});
it('PA-CAPABILITY-01 schedule discovery gives real commands without executing', async () => {
  const result = await call('personal_schedule_help');
  for (const verb of ['list', 'create', 'update']) expect(result.content[0].text).toContain(`config cron current ${verb}`);
  expect(m.invoke).not.toHaveBeenCalled();
});

it('PA-CAPABILITY-01 owner removal during pending approval prevents the approved write', async () => {
  const pending = call('personal_assistant_create', { name: 'New profile' });
  await vi.waitFor(() => expect(m.confirm).toHaveBeenCalled());
  m.load.mockReturnValue({ items: [] }); m.confirm.mock.calls[0][0].onOk();
  expect(await pending).toMatchObject({ isError: true }); expect(m.add).not.toHaveBeenCalled();
});
it('PA-CAPABILITY-01 scheduled or delegated source cannot recursively create profiles', async () => {
  for (const source of ['schedule', 'personal'] as const) {
    self.messages = [{ id: source, type: 'user', text: '创建助理', at: 1, source }];
    expect(await call('personal_assistant_create', { name: 'New profile' })).toMatchObject({ isError: true });
  }
  expect(m.confirm).not.toHaveBeenCalled(); expect(m.add).not.toHaveBeenCalled();
});
