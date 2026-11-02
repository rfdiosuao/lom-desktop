import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Schedule } from '@/state/types';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), model: vi.fn() }));
vi.mock('./phoneRpc', () => ({ phoneRpc: mocks.rpc }));
vi.mock('./phoneModel', () => ({ syncPhoneModel: mocks.model }));
vi.mock('./phoneChat', () => ({ syncPhoneHistory: vi.fn() }));
const { changePhoneSchedule, resolvePendingPhoneRuns } = await import('./phoneSchedules');
const { loadPhoneCache, savePhoneCache } = await import('./phoneCache');

const form = (): Schedule => ({ id: '', exec: 'dev_a', name: '巡检', prompt: '检查', freq: 'weekly', days: [0, 1], every: 60, time: '09:00', enabled: true, runIn: 'new', runs: [], last: null });
const task = (revision = 'rev'): Schedule => ({ ...form(), id: 'ps:dev_a:task', phoneTask: 'task', revision });
const phoneRow = (revision = 'rev') => ({ id: 'task', revision, name: '巡检', prompt: '检查', freq: 'weekly', time: '09:00', days: '[7,1]', every: '60', enabled: 'true', session_id: '', next: '', last: '', runs: '[]', editable: 'true' });
const listReply = (revision = 'rev') => ({ items: JSON.stringify([phoneRow(revision)]), timezone: 'Asia/Taipei', exact: 'true' });
const listed = (id = 'ps:dev_a:task') => S.schedules.find(x => x.id === id);
let account = 0;

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  S.cloud = 'signed-in';
  S.account = { id: `st06-${++account}`, name: 'A', email: '' };
  S.schedules = [];
  S.convs = [];
});
afterEach(() => vi.restoreAllMocks());

it('ST06 unit: retry after restart reuses the persisted request id and clears it only after accepted', async () => {
  const x: Schedule = { ...task(), id: 'ps:dev_a:task' };
  S.schedules = [x];
  mocks.rpc.mockRejectedValueOnce(new Error('relay.reply_timeout'));
  await expect(changePhoneSchedule(x, 'schedule.run')).rejects.toThrow('timeout');
  const pendingId = x.pendingRun;
  expect(pendingId).toBeTruthy();
  expect(x.pendingRunTask).toBe('task');
  expect(x.pendingRunRevision).toBe('rev');
  await savePhoneCache();

  /* 模拟重启：内存清空，从本地缓存恢复 */
  S.schedules = [];
  loadPhoneCache();
  expect(listed()?.pendingRun).toBe(pendingId);

  /* 手机重新可达：补发同一请求 ID，答复 accepted 后才清除 */
  mocks.rpc.mockImplementation(async (_d: string, method: string) =>
    method === 'schedule.run' ? { status: 'accepted', session_id: 's' } : listReply());
  await resolvePendingPhoneRuns('dev_a');
  const runs = mocks.rpc.mock.calls.filter(c => c[1] === 'schedule.run');
  expect(runs.map(c => c[2].request_id)).toEqual([pendingId, pendingId]);
  expect(listed()?.pendingRun).toBeUndefined();

  /* 清除结果落盘：重启后不会再补发 */
  await savePhoneCache();
  S.schedules = [];
  loadPhoneCache();
  expect(listed()?.pendingRun).toBeUndefined();
});

it('ST06 unit (模拟手机回执，真机未执行): executed → lost reply → restart → retry only executes once', async () => {
  const receipts = new Map<string, unknown>();
  let executions = 0;
  mocks.rpc.mockImplementation(async (_d: string, method: string, p: { request_id: string }) => {
    if (method === 'schedule.list') return listReply();
    if (method !== 'schedule.run') return { status: 'ok' };
    /* 与手机端 LomRemoteSchedules 的回执语义一致：同一 request_id 命中回执就不再业务执行 */
    const saved = receipts.get(p.request_id);
    if (saved) return saved;
    executions += 1;
    const reply = { status: 'accepted', session_id: 'session-1' };
    receipts.set(p.request_id, reply);
    if (executions === 1) throw new Error('relay.reply_timeout');
    return reply;
  });
  const x = task();
  S.schedules = [x];
  await expect(changePhoneSchedule(x, 'schedule.run')).rejects.toThrow('timeout');
  expect(executions).toBe(1);
  await savePhoneCache();

  S.schedules = [];
  loadPhoneCache();
  await resolvePendingPhoneRuns('dev_a');
  expect(executions).toBe(1);
  expect(listed()?.pendingRun).toBeUndefined();
});

it.each(['dispatching', 'protocol-unknown'])('ST06 unit: %s reply keeps the pending request id because the outcome is unknown', async status => {
  const x = task();
  S.schedules = [x];
  mocks.rpc.mockResolvedValueOnce({ status });
  await expect(changePhoneSchedule(x, 'schedule.run')).rejects.toThrow('尚未确认');
  expect(x.pendingRun).toBeTruthy();
  expect(x.pendingError).toContain('未知');
});

it('ST06 unit: failed reply clears the pending id because the phone reports it did not start', async () => {
  const x = task();
  S.schedules = [x];
  mocks.rpc.mockResolvedValueOnce({ status: 'failed' });
  await expect(changePhoneSchedule(x, 'schedule.run')).rejects.toThrow('未执行');
  expect(x.pendingRun).toBeUndefined();
  expect(x.pendingError).toContain('未执行');
});

it.each(['schedule.missing', 'schedule.id_reused', 'schedule.dispatch_failed'])('ST06 unit: definite RPC error %s clears the pending id', async code => {
  const x = task();
  S.schedules = [x];
  mocks.rpc.mockRejectedValueOnce(new Error(code));
  await expect(changePhoneSchedule(x, 'schedule.run')).rejects.toThrow(code);
  expect(x.pendingRun).toBeUndefined();
});

it('ST06 unit: schedule.receipt_failed keeps the id because it may happen after dispatch', async () => {
  const x = task();
  S.schedules = [x];
  mocks.rpc.mockRejectedValueOnce(new Error('schedule.receipt_failed'));
  await expect(changePhoneSchedule(x, 'schedule.run')).rejects.toThrow('receipt_failed');
  expect(x.pendingRun).toBeTruthy();
});

it('ST06 unit: restore stops auto-replay after the 10-minute window and asks for manual confirmation', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const x: Schedule = { ...task(), pendingRun: '0123456789abcdef', pendingOp: 'schedule.run',
    pendingRunAt: Date.now() - 10 * 60_000 - 1, pendingRunRuns: 1, pendingRunTask: 'task', pendingRunRevision: 'rev' };
  S.schedules = [x];
  mocks.rpc.mockImplementation(async () => listReply());
  await resolvePendingPhoneRuns('dev_a');
  expect(mocks.rpc.mock.calls.filter(c => c[1] === 'schedule.run')).toHaveLength(0);
  expect(x.pendingRun).toBeUndefined();
  expect(x.pendingError).toContain('超过 10 分钟');
  expect(x.pendingError).toContain('手机运行记录');
  expect(warn.mock.calls.some(c => String(c[0]).includes('转人工确认'))).toBe(true);
});

it('ST06 unit: an old cache without pendingRunAt is treated as expired and is not replayed', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const x: Schedule = { ...task(), pendingRun: '0123456789abcdef', pendingOp: 'schedule.run',
    pendingRunRuns: 1, pendingRunTask: 'task', pendingRunRevision: 'rev' };
  S.schedules = [x];
  mocks.rpc.mockImplementation(async () => listReply());
  await resolvePendingPhoneRuns('dev_a');
  expect(mocks.rpc.mock.calls.filter(c => c[1] === 'schedule.run')).toHaveLength(0);
  expect(x.pendingRun).toBeUndefined();
  expect(x.pendingError).toContain('超过 10 分钟');
  expect(warn.mock.calls.some(c => String(c[0]).includes('转人工确认'))).toBe(true);
});

it('ST06 unit: a user-initiated run after the window starts a new request id instead of replaying the old one', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const x: Schedule = { ...task(), pendingRun: '0123456789abcdef', pendingOp: 'schedule.run',
    pendingRunAt: Date.now() - 10 * 60_000 - 1, pendingRunRuns: 1, pendingRunTask: 'task', pendingRunRevision: 'rev' };
  S.schedules = [x];
  mocks.rpc.mockResolvedValueOnce({ status: 'accepted', session_id: 's' });
  mocks.rpc.mockResolvedValueOnce(listReply());
  await changePhoneSchedule(x, 'schedule.run');
  const run = mocks.rpc.mock.calls.find(c => c[1] === 'schedule.run')!;
  expect(run[2].request_id).not.toBe('0123456789abcdef');
  expect(x.pendingRun).toBeUndefined();
  expect(warn.mock.calls.some(c => String(c[0]).includes('超过自动核对窗口'))).toBe(true);
});

it('ST06 unit: rejected reply is a definite rejection and clears the pending id', async () => {
  const x = task();
  S.schedules = [x];
  mocks.rpc.mockResolvedValueOnce({ status: 'rejected' });
  await expect(changePhoneSchedule(x, 'schedule.run')).rejects.toThrow('未执行');
  expect(x.pendingRun).toBeUndefined();
});

it('ST06 unit: translated sync.conflict keeps its code and clears the pending id as not executed', async () => {
  const x = task();
  S.schedules = [x];
  const conflict = Object.assign(new Error('手机内容已更新，未覆盖。请保留草稿并重新载入手机版本。'), { code: 'sync.conflict' });
  mocks.rpc.mockRejectedValueOnce(conflict);
  await expect(changePhoneSchedule(x, 'schedule.run')).rejects.toThrow('未覆盖');
  expect(x.pendingRun).toBeUndefined();
});

it('ST06 unit: restore does not replay when the task revision changed while the run was unconfirmed', async () => {
  const x = task();
  S.schedules = [x];
  mocks.rpc.mockRejectedValueOnce(new Error('relay.reply_timeout'));
  await expect(changePhoneSchedule(x, 'schedule.run')).rejects.toThrow('timeout');
  const pendingId = x.pendingRun;
  x.revision = 'rev-2';
  mocks.rpc.mockClear();
  mocks.rpc.mockImplementation(async () => listReply('rev-2'));
  await resolvePendingPhoneRuns('dev_a');
  expect(mocks.rpc.mock.calls.filter(c => c[1] === 'schedule.run')).toHaveLength(0);
  expect(x.pendingRun).toBe(pendingId);
  expect(x.pendingError).toContain('修改');
});

it('ST06 unit: a user-initiated run after the task changed starts a new request id', async () => {
  const x = task();
  S.schedules = [x];
  mocks.rpc.mockRejectedValueOnce(new Error('relay.reply_timeout'));
  await expect(changePhoneSchedule(x, 'schedule.run')).rejects.toThrow('timeout');
  const oldId = x.pendingRun;
  x.revision = 'rev-2';
  mocks.rpc.mockResolvedValueOnce({ status: 'accepted', session_id: 's' });
  mocks.rpc.mockResolvedValueOnce(listReply('rev-2'));
  await changePhoneSchedule(x, 'schedule.run');
  const runs = mocks.rpc.mock.calls.filter(c => c[1] === 'schedule.run');
  expect(runs[runs.length - 1][2].request_id).not.toBe(oldId);
  expect(listed()?.pendingRun).toBeUndefined();
});

it('ST06 unit: cache write failure while keeping an unknown run is logged with a reason and keeps the visible id', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const original = Storage.prototype.setItem;
  let cacheWrites = 0;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (key.startsWith('lom.phone-cache.v1:') && ++cacheWrites === 2) throw new Error('quota');
    return original.call(this, key, value);
  });
  const x = task();
  S.schedules = [x];
  mocks.rpc.mockRejectedValueOnce(new Error('relay.reply_timeout'));
  await expect(changePhoneSchedule(x, 'schedule.run')).rejects.toThrow('timeout');
  expect(x.pendingRun).toBeTruthy();
  expect(x.pendingError).toContain('timeout');
  expect(log.mock.calls.some(c => String(c[0]).includes('未能写入本地缓存'))).toBe(true);
});

it('ST06 a cache write failure before dispatch must not send the run request', async () => {
  const x = { ...form(), phoneTask: 'task', revision: 'rev' };
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  try {
    await expect(changePhoneSchedule(x, 'schedule.run')).rejects.toThrow('没有下发');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(x.pendingRun).toBeUndefined();
  } finally { Storage.prototype.setItem = setItem; }
});
