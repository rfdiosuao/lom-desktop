import { beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { Conv } from '@/state/types';

const m = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), cloud: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
vi.mock('@/features/account/runtime/cloud', async load => ({ ...await load<object>(), cloud: m.cloud }));
vi.mock('./phoneCache', () => ({ savePhoneCache: vi.fn(), loadPhoneCache: vi.fn() }));

const link = await import('./deviceLink');
const { phoneRpc } = await import('./phoneRpc');
const { capturePhone } = await import('./phoneScreen');
const { syncPhoneHistory, refreshPhoneChat } = await import('./phoneChat');
const { dropPhone } = await import('./devices');

const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const signIn = (id = 'acc') => { S.cloud = 'signed-in'; S.account = { id, name: '', email: '' }; };
/** phoneRpc 走真实实现：加密 / 解密由 invoke 模拟，云端转发由 cloud 模拟 */
let reply: (method: string, payload: unknown) => Promise<unknown>;
beforeEach(() => {
  vi.clearAllMocks(); signIn();
  S.agents.dev = { id: 'dev', kind: 'phone', name: '手机', persona: '', status: 'online', real: true, lastSeen: Date.now() };
  S.phoneOrder = ['dev']; S.convs = [];
  link.dropLink('dev'); link.observeDevice('dev', true);
  let last: { id: string; method: string; payload: string } | undefined;
  m.invoke.mockImplementation(async (cmd: string, args: { id?: string; text?: string; envelope?: { id: string } }) => {
    if (cmd === 'remote_seal') { const r = JSON.parse(args.text!); last = { id: args.id!, method: r.method, payload: r.payload }; return { id: args.id }; }
    if (cmd === 'remote_open') return JSON.stringify(await reply(last!.method, JSON.parse(last!.payload)).then(p => ({ status: 'ok', payload: JSON.stringify(p) }), (e: Error) => ({ status: 'error', error: e.message })));
    return undefined;
  });
  m.cloud.mockImplementation(async () => ({ id: last!.id }));
  reply = async () => ({});
});

it('REFACTOR-01-M2 AC-1 解绑期间迟到的会话列表不会把手机会话写回来', async () => {
  const page = deferred<unknown>();
  reply = method => method === 'chat.list' ? page.promise : Promise.resolve({});
  const sync = syncPhoneHistory('dev');
  await vi.waitFor(() => expect(m.cloud).toHaveBeenCalled());
  update(s => dropPhone(s, 'dev'));
  page.resolve({ items: [{ id: 's1', title: '旧会话', updated: 1, running: true, pinned: false }], total: 1, next: 1 });
  await expect(sync).rejects.toThrow(link.STALE_LINK);
  expect(S.convs.some(c => c.owner === 'dev')).toBe(false);
  expect(S.running['phone:dev:s1']).toBeUndefined();
});

it('REFACTOR-01-M2 AC-2 读取手机会话期间换账号，旧回执不写回界面', async () => {
  const c: Conv = { id: 'phone:dev:s1', owner: 'dev', phoneSession: 's1', title: '', updated: 0, messages: [] };
  S.convs = [c];
  const read = deferred<unknown>();
  reply = method => method === 'chat.read' ? read.promise : Promise.resolve({});
  const refresh = refreshPhoneChat(c);
  await vi.waitFor(() => expect(m.cloud).toHaveBeenCalled());
  signIn('other');
  read.resolve({ items: [{ id: 'r1', role: 'assistant', text: '旧账号的回复', at: 1 }], total: 1, next: 1, running: true, status: 'running', error: '' });
  await expect(refresh).rejects.toThrow();
  expect(c.messages).toEqual([]);
  expect(S.running[c.id]).toBeUndefined();
});

it('REFACTOR-01-M2 AC-3 手机下线又上线后，之前发起的截图作废', async () => {
  const frame = deferred<unknown>();
  reply = method => method === 'screen.capture' ? frame.promise : Promise.resolve({});
  const capture = capturePhone('dev');
  await vi.waitFor(() => expect(m.cloud).toHaveBeenCalled());
  link.observeDevice('dev', false); link.observeDevice('dev', true);
  frame.resolve({ mime: 'image/jpeg', image: 'AAAA', width: '1', height: '1', captured_at: '1' });
  await expect(capture).rejects.toThrow(link.STALE_LINK);
});

it('REFACTOR-01-M2 AC-4 「在线」「RPC 可用」「同步完成」分开记录', async () => {
  expect(link.linkSnapshot('dev')).toMatchObject({ online: true, rpc: 'unknown', syncedAt: undefined });
  m.cloud.mockRejectedValueOnce(new Error('relay timeout'));
  await expect(phoneRpc('dev', 'chat.list', {})).rejects.toThrow('relay timeout');
  expect(link.linkSnapshot('dev')).toMatchObject({ online: true, rpc: 'failed', rpcError: 'relay timeout' });
  reply = async () => { throw new Error('screen.permission_required'); };
  await expect(phoneRpc('dev', 'screen.capture', {})).rejects.toThrow('screen.permission_required');
  expect(link.linkSnapshot('dev').rpc).toBe('ok'); // 手机回了业务错误：传输可用
  link.recordSynced('dev');
  expect(link.linkSnapshot('dev').syncedAt).toBeGreaterThan(0);
  link.observeDevice('dev', false);
  expect(link.linkSnapshot('dev')).toMatchObject({ online: false, rpc: 'unknown' });
});

it('REFACTOR-01-M2 AC-5 换账号后旧账号的设备记录与守卫全部失效', () => {
  const guard = link.linkGuard('dev');
  expect(guard()).toBe(true);
  signIn('other');
  expect(guard()).toBe(false);
  expect(link.linkSnapshot('dev')).toMatchObject({ online: false, generation: 0 });
  signIn('acc');
  expect(guard()).toBe(false); // 切回原账号也不复活旧守卫
});
