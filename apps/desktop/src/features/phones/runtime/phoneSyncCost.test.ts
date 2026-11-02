import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';

const m = vi.hoisted(() => ({ rpc: vi.fn(), api: vi.fn() }));
vi.mock('./phoneRpc', () => ({ phoneRpc: m.rpc }));
vi.mock('@/core/client', () => ({ api: m.api }));
vi.mock('./phoneCache', () => ({ savePhoneCache: vi.fn(), loadPhoneCache: vi.fn() }));
const { savePhoneCache } = await import('./phoneCache');
const { refreshPhoneChat, syncPhoneHistory } = await import('./phoneChat');
const { syncPhoneModel } = await import('./phoneModel');

const row = (i: number, text = `m${i}`) => ({ id: `r${i}`, role: i % 2 ? 'assistant' : 'user', text, at: i });
let history: ReturnType<typeof row>[] = [];
let key = 'KEY_A';
const read = (offset: number) => {
  const items = history.slice(offset, offset + 50);
  return { items, total: history.length, next: offset + items.length, running: false, status: 'idle', error: '' };
};
const reads = () => m.rpc.mock.calls.filter(c => c[1] === 'chat.read').map(c => c[2].offset);

beforeEach(() => {
  vi.clearAllMocks();
  S.cloud = 'signed-in'; S.account = { id: 'acc', name: 'A', email: '' }; S.model = 'own::test-model';
  // 未单独选择手机模型：允许跟随电脑当前模型（ST05 明确保留的路径）
  S.phoneModel = '';
  S.providers = [{ id: 'own', name: 'My Key', platform: 'openai', base_url: 'https://fixture.invalid/v1', models: ['test-model'], enabled: true, created_at: 0 }];
  history = Array.from({ length: 60 }, (_, i) => row(i));
  m.rpc.mockImplementation(async (_d: string, method: string, p: { offset: number }) => method === 'chat.read' ? read(p.offset) : { status: 'saved' });
  key = 'KEY_A';
  // A fresh object per call: syncPhoneModel wipes the key from what it read.
  m.api.mockImplementation(async () => [{ id: 'own', enabled: true, models: ['test-model'], api_key: key, base_url: 'https://fixture.invalid/v1', platform: 'openai' }]);
});

const conv = (id: string): Conv => ({ id, owner: 'dev_a', phoneSession: 's1', title: 't', updated: 1, messages: [] });

it('MODEL-SYNC-01 explicit unavailable phone model never falls back to desktop', async () => {
  S.phoneModel = 'removed::missing';
  await expect(syncPhoneModel('dev_missing')).rejects.toThrow('未改用电脑模型');
  expect(m.rpc).not.toHaveBeenCalled();
});

it('R02-01 polling re-reads only the tail of a phone conversation', async () => {
  const c = conv('cost-tail');
  expect(await refreshPhoneChat(c)).toBe(true);
  expect(reads()).toEqual([0, 50]);
  expect(c.messages).toHaveLength(60);
  m.rpc.mockClear();
  // The streaming reply grows and one more row arrives: only the last two rows and the new one are read.
  history[59] = row(59, 'm59 longer'); history.push(row(60));
  expect(await refreshPhoneChat(c)).toBe(true);
  expect(reads()).toEqual([58]);
  expect(c.messages.at(-2)?.text).toBe('m59 longer');
  m.rpc.mockClear();
  expect(await refreshPhoneChat(c)).toBe(false);
  expect(reads()).toEqual([59]);
});

it('R02-01 reloads the whole history when the tail no longer lines up', async () => {
  const c = conv('cost-mismatch');
  await refreshPhoneChat(c);
  m.rpc.mockClear();
  history = history.map((r, i) => ({ ...r, id: `x${i}` }));
  await refreshPhoneChat(c);
  expect(reads()).toEqual([58, 0, 50]);
  expect(c.messages[0].id).toContain('x0');
});

it('R02-01 sends the API key to a phone only when the model config changed', async () => {
  const syncs = () => m.rpc.mock.calls.filter(c => c[1] === 'model.sync').length;
  await syncPhoneModel('dev_cost');
  await syncPhoneModel('dev_cost');
  expect(syncs()).toBe(1);
  key = 'KEY_B';
  await syncPhoneModel('dev_cost');
  expect(syncs()).toBe(2);
  await syncPhoneModel('dev_cost', true);
  expect(syncs()).toBe(3);
  await syncPhoneModel('dev_other');
  expect(syncs()).toBe(4);
});

it('R02-01 a failed model sync is retried on the next send', async () => {
  m.rpc.mockRejectedValueOnce(new Error('relay.reply_timeout'));
  await expect(syncPhoneModel('dev_retry')).rejects.toThrow('timeout');
  await syncPhoneModel('dev_retry');
  expect(m.rpc.mock.calls.filter(c => c[1] === 'model.sync')).toHaveLength(2);
});

it('R02-01 quick session-list sync stops after an unchanged first page', async () => {
  const list = { items: [{ id: 's1', title: 'a', updated: 1, running: false, pinned: false }], total: 1, next: 1 };
  m.rpc.mockImplementation(async () => list);
  expect(await syncPhoneHistory('dev_list', true)).toBe(true);
  expect(await syncPhoneHistory('dev_list', true)).toBe(false);
  list.items[0].updated = 2;
  expect(await syncPhoneHistory('dev_list', true)).toBe(true);
  expect(S.convs.find(c => c.owner === 'dev_list')?.updated).toBe(2);
});

it('PHONE-TEAM-01 phone status-only updates persist without inventing completion from idle', async () => {
  const c = conv('status-only');
  await refreshPhoneChat(c); expect(c.phoneRunStatus).toBe('idle');
  expect(c.phoneSyncedAt).toBeGreaterThan(0);
  vi.mocked(savePhoneCache).mockClear();
  m.rpc.mockImplementation(async (_d: string, _method: string, p: { offset: number }) => ({ ...read(p.offset), status: 'cancelled' }));
  expect(await refreshPhoneChat(c)).toBe(true);
  expect(c.phoneRunStatus).toBe('cancelled'); expect(savePhoneCache).toHaveBeenCalledOnce();
  m.rpc.mockImplementation(async (_d: string, _method: string, p: { offset: number }) => ({ ...read(p.offset), status: 'completed', error: '模型调用失败' }));
  await refreshPhoneChat(c); expect(c.phoneRunStatus).toBe('failed');
  expect(c.messages.at(-1)).toMatchObject({ type: 'system', text: '模型调用失败' });
});
