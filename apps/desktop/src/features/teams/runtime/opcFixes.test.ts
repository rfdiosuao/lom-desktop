import { beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { Conv, Team } from '@/state/types';

/* 打开 OPC 团队就报「加载任务记录失败：核心没有返回任务使用的模型」、设置里 Agent 重复、Leader 名单露在聊天记录里 */
const m = vi.hoisted(() => ({ api: vi.fn(), toastError: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => ({ url: 'http://core', token: 't', defaultFolder: '/work', homeDir: '/Users/me' }) }));
vi.mock('@/shared/overlays/controller', () => ({ toast: vi.fn(), toastError: m.toastError, openModal: vi.fn(), closeModal: vi.fn(), confirm: vi.fn(), prompt: vi.fn(), topModal: () => undefined }));
const { openTask } = await import('@/features/chat/runtime/tasks');
const { dedupeAgents } = await import('@/features/settings/runtime/agents');
const { rosterContext, rosterDelivered } = await import('./team');
const { stripSettingsContext, publicationPolicy } = await import('@/features/settings/runtime/preferences');

beforeEach(() => { vi.clearAllMocks(); });

it('opening an external Agent task (core returns no model) loads its history instead of failing', async () => {
  const c: Conv = { id: 'codex1', owner: 'pc', title: 'Codex', updated: 0, messages: [], remote: true, agentId: 'ag_codex', agentName: 'Codex CLI' };
  update(s => { s.convs = [c]; });
  m.api.mockImplementation(async (_method: string, path: string) => {
    if (path === '/api/conversations/codex1') return { id: 'codex1', type: 'acp', model: null, runtime: { is_processing: false } };
    if (path.startsWith('/api/conversations/codex1/messages')) return { items: [] };
    if (path.endsWith('/confirmations')) return [];
    return {};
  });
  await openTask('codex1');
  expect(m.toastError).not.toHaveBeenCalled();
  expect(S.convs[0].loaded).toBe(true);
});

it('a Lom task without a model is still reported (the check only skips external Agents)', async () => {
  const c: Conv = { id: 'lom1', owner: 'pc', title: 'Lom', updated: 0, messages: [], remote: true };
  update(s => { s.convs = [c]; });
  m.api.mockResolvedValue({ id: 'lom1', model: null });
  await openTask('lom1');
  expect(m.toastError).toHaveBeenCalledWith('加载任务记录失败', expect.any(Error));
});

it('the Agents list shows a duplicated name once, keeping the ACP entry', () => {
  const row = (id: string, name: string, agent_type: string, backend?: string) => ({ id, name, agent_type, backend, agent_source: 'builtin', enabled: true, installed: false, status: 'missing' as const });
  const out = dedupeAgents([row('a', 'Codex CLI', 'acp', 'codex'), row('gw', 'Twin', 'gateway'), row('acp', 'Twin', 'acp', 'twin'), row('n', 'Nanobot', 'nanobot')]);
  expect(out.map(a => a.id)).toEqual(['a', 'acp', 'n']);
});

it('the Leader gets the roster once per change, and it never shows up as the user message', () => {
  const t: Team = { id: 't1', name: '外卖小队', folder: '/work', created: 1, real: true, panes: {}, members: [{ mid: 'l', agent: 'pc', role: '总编', leader: true }] };
  update(s => { s.teams = [t]; });
  const first = rosterContext(t);
  expect(first).toContain('[LOM_TEAM_V1]');
  // 审计 A02：核心还没收下就不算送达，失败重试仍要带名单；送达后才去重
  expect(rosterContext(t)).toBe(first);
  rosterDelivered(t, first);
  expect(rosterContext(t)).toBe('');
  update(() => { t.members.push({ mid: 'x', agent: 'ag:ag_kimi', role: '看视频' }); });
  expect(rosterContext(t)).toContain('看视频');
  expect(stripSettingsContext(`${publicationPolicy()}\n\n${first}帮我点外卖`)).toBe('帮我点外卖');
});

it('stopping the Leader does not write 「已停止。」 into idle members, and skips idle offline phones', async () => {
  const { stopTask } = await import('@/features/chat/runtime/cancel');
  S.agents.dev_off = { id: 'dev_off', kind: 'phone', name: '旧手机', real: true, status: 'offline' } as never;
  const leader: Conv = { id: 'lead', owner: 'pc', title: 'Leader', updated: 0, messages: [], remote: true };
  const idle: Conv = { id: 'kimi', owner: 'pc', title: 'Kimi', updated: 0, messages: [], remote: true, agentId: 'ag_kimi', parentTask: 'lead' };
  const phone: Conv = { id: 'ph', owner: 'dev_off', title: '手机', updated: 0, messages: [], phoneSession: 's1', parentTask: 'lead' };
  update(s => { s.convs = [leader, idle, phone]; s.running = { lead: true }; });
  let leadBusy = true;
  m.api.mockImplementation(async (method: string, path: string) => {
    if (method === 'POST' && path === '/api/conversations/lead/cancel') { leadBusy = false; return { runtime: { is_processing: false, turn_id: null } }; }
    if (path === '/api/conversations/lead') return { runtime: { is_processing: leadBusy, turn_id: leadBusy ? 't1' : null } };
    return { runtime: { is_processing: false, turn_id: null } };
  });
  expect(await stopTask('lead')).toBe(true);
  expect(S.convs[0].messages.at(-1)?.text).toBe('已停止。');
  expect(S.convs[1].messages).toHaveLength(0);
  expect(m.api.mock.calls.some(c => c[0] === 'POST' && c[1] === '/api/conversations/kimi/cancel')).toBe(false);
});
