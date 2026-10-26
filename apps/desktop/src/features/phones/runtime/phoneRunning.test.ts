import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';

const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./phoneRpc', () => ({ phoneRpc: m.rpc }));
vi.mock('@/core/client', () => ({ api: vi.fn() }));
vi.mock('./phoneCache', () => ({ savePhoneCache: vi.fn(), loadPhoneCache: vi.fn() }));
const { syncPhoneHistory } = await import('./phoneChat');

type Row = { id: string; title: string; updated: number; pinned: boolean; running: boolean };
const row = (id: string, running: boolean, updated = 1): Row => ({ id, title: id, updated, pinned: false, running });
let list: Row[] = [];
const idOf = (session: string) => `phone:dev_a:${session}`;

beforeEach(() => {
  vi.clearAllMocks();
  S.cloud = 'signed-in'; S.account = { id: 'acc', name: 'A', email: '' };
  S.convs = []; S.running = {};
  list = [];
  m.rpc.mockImplementation(async (_d: string, method: string) => {
    if (method === 'chat.list') return { items: list, total: list.length, next: list.length };
    throw new Error(`unexpected ${method}`);
  });
});

it('ST07 a session that is not open shows as running when the phone list says so, and stops when it finishes', async () => {
  list = [row('s1', true)];
  await syncPhoneHistory('dev_a');
  expect(S.running[idOf('s1')]).toBe(true);

  // 手机上跑完：只有 running 变了，快速同步也必须发现并更新
  list = [row('s1', false)];
  expect(await syncPhoneHistory('dev_a', true)).toBe(true);
  expect(S.running[idOf('s1')]).toBe(false);
});

it('ST07 a session that starts running in the background is picked up without opening it', async () => {
  list = [row('s1', false)];
  await syncPhoneHistory('dev_a');
  expect(S.running[idOf('s1')]).toBe(false);

  list = [row('s1', true)];
  await syncPhoneHistory('dev_a', true);
  expect(S.running[idOf('s1')]).toBe(true);
});

it('ST07 only the sessions that report running spin', async () => {
  list = [row('s1', true), row('s2', false), row('s3', true)];
  await syncPhoneHistory('dev_a');
  expect([S.running[idOf('s1')], S.running[idOf('s2')], S.running[idOf('s3')]]).toEqual([true, false, true]);
});

it('ST07 a session deleted on the phone leaves no spinner behind', async () => {
  list = [row('s1', true), row('s2', true)];
  await syncPhoneHistory('dev_a');
  expect(S.running[idOf('s2')]).toBe(true);

  list = [row('s1', true)];
  await syncPhoneHistory('dev_a');
  expect(S.convs.map(c => c.id)).toEqual([idOf('s1')]);
  expect(idOf('s2') in S.running).toBe(false);
  expect(S.running[idOf('s1')]).toBe(true);
});

it('ST07 other phones keep their running state', async () => {
  S.convs.push({ id: 'phone:dev_b:x', phoneSession: 'x', owner: 'dev_b', title: 'x', updated: 1, messages: [] } as Conv);
  S.running['phone:dev_b:x'] = true;
  list = [row('s1', false)];
  await syncPhoneHistory('dev_a');
  expect(S.running['phone:dev_b:x']).toBe(true);
  expect(S.convs.some(c => c.id === 'phone:dev_b:x')).toBe(true);
});

it('ST07 a message with an unconfirmed send keeps its own running state and is not removed', async () => {
  S.convs.push({ id: idOf('s1'), phoneSession: 's1', owner: 'dev_a', title: 's1', updated: 1, messages: [],
    phonePending: { client_id: 'c', session_id: 's1', text: 'hi', policy: '', files: '[]' } } as Conv);
  S.running[idOf('s1')] = true;
  // 手机列表还没来得及显示这条正在发送的会话是运行中
  list = [row('s1', false)];
  await syncPhoneHistory('dev_a');
  expect(S.running[idOf('s1')]).toBe(true);

  // 手机上看不到这条会话，但电脑这边的发送还没确认：会话保留
  list = [];
  await syncPhoneHistory('dev_a');
  expect(S.convs.some(c => c.id === idOf('s1'))).toBe(true);
  expect(S.running[idOf('s1')]).toBe(true);
});
