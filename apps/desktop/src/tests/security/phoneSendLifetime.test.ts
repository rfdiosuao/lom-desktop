import { expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { beginAuthChange } from '@/features/account/runtime/authScope';
import type { Conv } from '@/state/types';
const m = vi.hoisted(() => ({ cloud: vi.fn(), invoke: vi.fn(), upload: vi.fn(), model: vi.fn(), cache: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
vi.mock('@/features/account/runtime/cloud', () => ({ cloud: m.cloud }));
vi.mock('@/features/phones/runtime/phoneFiles', () => ({ uploadPhoneFile: m.upload }));
vi.mock('@/features/phones/runtime/phoneModel', () => ({ ensurePhoneModel: m.model, syncPhoneModel: vi.fn() }));
vi.mock('@/features/phones/runtime/phoneCache', () => ({ savePhoneCache: m.cache }));
vi.mock('@/app/sound', () => ({ taskFinished: vi.fn() }));
import { sendPhone } from '@/features/phones/runtime/phoneChat';
it('INDEPENDENT-03 logout/login invalidates an old phone send even for the same account', async () => {
  const c: Conv = { id: 'review-phone', owner: 'dev_test', title: 'Phone', updated: 1, messages: [] };
  S.account = { id: 'a', name: 'A', email: '' }; S.cloud = 'signed-in'; S.convs = [c]; S.running = {};
  let finish!: (id: string) => void;
  m.upload.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
  m.model.mockResolvedValue(undefined); m.cache.mockResolvedValue(undefined);
  m.invoke.mockImplementation(async (command, args) => {
    if (command === 'remote_seal') return { id: args.id, testMethod: JSON.parse(args.text).method };
    return JSON.stringify({ status: 'ok', payload: JSON.stringify(args.envelope.testMethod === 'chat.send'
      ? { session_id: 'unexpected-send' }
      : { items: [], total: 0, next: 0, running: false, status: 'completed', error: '' }) });
  });
  m.cloud.mockImplementation(async (_method, _path, envelope) => envelope);
  const pending = sendPhone(c, '旧任务', [{ name: 'note.txt', path: '/selected/note.txt' }]);
  beginAuthChange(); S.cloud = 'signed-out'; S.account = null; S.convs = [];
  beginAuthChange(); S.account = { id: 'a', name: 'A', email: '' }; S.cloud = 'signed-in';
  finish('uploaded-before-login-change');
  await pending.catch(() => {});
  expect(m.cloud.mock.calls.filter(call => call[2].testMethod === 'chat.send')).toHaveLength(0);
});
it.each(['model', 'cache'])('PHONE-SEND-01 auth change during %s setup cannot submit or save under the new login', async phase => {
  vi.resetAllMocks();
  const c: Conv = { id: `review-${phase}`, owner: 'dev_test', title: 'Phone', updated: 1, messages: [] };
  S.account = { id: 'a', name: 'A', email: '' }; S.cloud = 'signed-in'; S.convs = [c]; S.running = {};
  let finish!: () => void;
  m.model.mockResolvedValue(undefined); m.cache.mockResolvedValue(undefined);
  (phase === 'model' ? m.model : m.cache).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = sendPhone(c, '旧任务');
  const rejected = expect(pending).rejects.toThrow(/账号/);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  beginAuthChange(); S.account = { id: 'b', name: 'B', email: '' }; S.convs = [];
  finish(); await rejected;
  expect(m.cloud).not.toHaveBeenCalled();
  expect(m.cache).toHaveBeenCalledTimes(phase === 'cache' ? 1 : 0);
});
it('PHONE-SEND-01 removing the target while preflight is pending invalidates sending', async () => {
  vi.resetAllMocks();
  const c: Conv = { id: 'review-removed', owner: 'dev_test', title: 'Phone', updated: 1, messages: [] };
  S.account = { id: 'a', name: 'A', email: '' }; S.cloud = 'signed-in'; S.convs = [c]; S.running = {};
  let finish!: () => void;
  m.model.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = sendPhone(c, '旧任务'); const rejected = expect(pending).rejects.toThrow(/会话/);
  S.convs = []; finish(); await rejected;
  expect(m.cloud).not.toHaveBeenCalled(); expect(m.cache).not.toHaveBeenCalled();
});

it('PHONE-SEND-01 auth change while delivery is in flight preserves pending identity and cannot update another login', async () => {
  vi.resetAllMocks();
  const c: Conv = { id: 'review-inflight', owner: 'dev_test', title: 'Phone', updated: 1, messages: [] };
  S.account = { id: 'a', name: 'A', email: '' }; S.cloud = 'signed-in'; S.convs = [c]; S.running = {};
  m.model.mockResolvedValue(undefined); m.cache.mockResolvedValue(undefined);
  m.invoke.mockImplementation(async (_command, args) => ({ id: args.id }));
  let finish!: () => void;
  m.cloud.mockImplementationOnce((_method, _path, envelope) => new Promise(resolve => { finish = () => resolve(envelope); }));
  const pending = sendPhone(c, '任务'); const rejected = expect(pending).rejects.toThrow(/账号/);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  const identity = c.phonePending?.client_id;
  beginAuthChange(); S.account = { id: 'b', name: 'B', email: '' }; S.convs = [];
  finish(); await rejected;
  expect(c.phonePending?.client_id).toBe(identity); expect(identity).toBeTruthy();
  expect(c.phoneSession).toBeUndefined(); expect(S.running[c.id]).toBeUndefined(); expect(m.cache).toHaveBeenCalledTimes(1);
});
