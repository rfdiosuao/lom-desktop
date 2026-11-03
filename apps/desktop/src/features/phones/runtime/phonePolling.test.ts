import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv, Team } from '@/state/types';

/* PHONE-POLL-01：屏幕上的手机会话（任务页或团队页）按快节奏读取；返回窗口、获得焦点或切换页面时立即读一次 */

const m = vi.hoisted(() => ({ rpc: vi.fn(), running: true }));
vi.mock('./phoneRpc', () => ({ phoneRpc: m.rpc }));
vi.mock('./phoneCache', () => ({ savePhoneCache: vi.fn(), loadPhoneCache: vi.fn() }));
vi.mock('@/app/sound', () => ({ taskFinished: vi.fn() }));
vi.mock('@/features/chat/runtime/tasks', () => ({ openTask: vi.fn() }));
vi.mock('@/features/settings/runtime/agentOptions', () => ({ loadConvOptions: vi.fn() }));
vi.mock('@/features/workspace/runtime/workspace', () => ({ activeFolder: () => '', refreshWorkspace: vi.fn() }));
const { watchPhone } = await import('./phoneChat');
const { go, openConv } = await import('@/app/navigation');

let hidden = false, serial = 0, c: Conv;
const reads = () => m.rpc.mock.calls.filter(call => call[1] === 'chat.read' && call[2].session_id === c.phoneSession).length;
const team = (id: string, memberConvs: Record<string, string> = {}): Team => ({ id, name: '团队', folder: '', created: 1, members: [], panes: {}, real: true, memberConvs });
const phoneConv = (extra: Partial<Conv> = {}): Conv => {
  const id = `phone-poll-${++serial}`;
  return { id, owner: 'dev_poll', phoneSession: `session-${id}`, title: '手机任务', updated: 1, messages: [], ...extra };
};
/** 先完成第一次读取：之后的间隔才是要比较的轮询节奏 */
const startWatching = async () => { void watchPhone(c); await vi.advanceTimersByTimeAsync(0); expect(reads()).toBe(1); };

beforeEach(() => {
  vi.useFakeTimers();
  m.rpc.mockReset(); m.running = true;
  m.rpc.mockImplementation(async (_device: string, method: string, p: { offset: number }) => method === 'chat.read'
    ? { items: [{ id: `row-${p.offset}`, role: 'assistant', text: '处理中', at: 1 }], total: 1, next: 1, running: m.running, status: m.running ? 'running' : 'completed', error: '' }
    : {});
  S.cloud = 'signed-in'; S.account = { id: 'poll-account', name: 'A', email: '' };
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  S.teams = [team('t1')]; S.route = { name: 'team', id: 't1' }; S.activeConv = 'someone-else';
});

afterEach(async () => {
  // 让手机报告完成，轮询自然结束，不把等待留给下一个用例
  m.running = false; hidden = false; S.route = { name: 'chat' }; S.activeConv = c.id;
  await vi.advanceTimersByTimeAsync(20000);
  vi.useRealTimers();
});

it('PHONE-POLL-01 a phone conversation shown on the team page re-reads after 1 s, not 8 s', async () => {
  c = phoneConv({ teamId: 't1' }); S.convs = [c]; S.running = { [c.id]: true };
  await startWatching();
  await vi.advanceTimersByTimeAsync(1000);
  expect(reads()).toBe(2);
});

it('PHONE-POLL-01 a member conversation recorded on the team counts as shown even without its team id', async () => {
  c = phoneConv(); S.teams = [team('t1', { phone: c.id })]; S.convs = [c]; S.running = { [c.id]: true };
  await startWatching();
  await vi.advanceTimersByTimeAsync(1000);
  expect(reads()).toBe(2);
});

it.each([
  ['another team page', () => { S.route = { name: 'team', id: 't2' }; }],
  ['a different open chat', () => { S.route = { name: 'chat' }; S.activeConv = 'someone-else'; }],
  ['a page left behind without resetting the open chat', () => { S.route = { name: 'skillhub' }; S.activeConv = c.id; }],
  ['a hidden window', () => { hidden = true; }],
])('PHONE-POLL-01 off screen (%s) keeps the 8 s pace', async (_label, place) => {
  c = phoneConv({ teamId: 't1' }); S.convs = [c]; S.running = { [c.id]: true };
  place();
  await startWatching();
  await vi.advanceTimersByTimeAsync(7900);
  expect(reads()).toBe(1);
  await vi.advanceTimersByTimeAsync(100);
  expect(reads()).toBe(2);
});

it('PHONE-POLL-01 returning to the window reads immediately instead of finishing the 8 s wait', async () => {
  c = phoneConv(); S.convs = [c]; S.running = { [c.id]: true };
  S.route = { name: 'chat' }; S.activeConv = c.id; hidden = true;
  await startWatching();
  await vi.advanceTimersByTimeAsync(500);
  hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);
  expect(reads()).toBe(2);
});

it('PHONE-POLL-01 focusing the window wakes only conversations that are on screen', async () => {
  c = phoneConv({ teamId: 't1' }); S.convs = [c]; S.running = { [c.id]: true };
  S.route = { name: 'settings' };
  await startWatching();
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
  expect(reads()).toBe(1);
  S.route = { name: 'team', id: 't1' };
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
  expect(reads()).toBe(2);
});

it.each([
  ['opening the conversation', (x: Conv) => openConv(x.id)],
  ['opening its team page', () => go('team', 't1')],
])('PHONE-POLL-01 %s reads immediately', async (_label, open) => {
  c = phoneConv({ teamId: 't1' }); S.convs = [c]; S.running = { [c.id]: true };
  S.route = { name: 'skillhub' };
  await startWatching();
  open(c);
  await vi.advanceTimersByTimeAsync(0);
  expect(reads()).toBe(2);
});

it('PHONE-CONTEXT-02 visible running replies never back off to four-second reads', async () => {
  c = phoneConv(); S.convs = [c]; S.running = { [c.id]: true };
  S.route = { name: 'chat' }; S.activeConv = c.id;
  await startWatching();
  await vi.advanceTimersByTimeAsync(10000);
  expect(reads()).toBeGreaterThanOrEqual(7);
});
