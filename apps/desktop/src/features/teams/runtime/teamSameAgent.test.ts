import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Team } from '@/state/types';

const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => ({ url: 'http://core', token: 't', defaultFolder: '/work', homeDir: '/Users/me' }) }));
vi.mock('@/features/phones/runtime/phoneChat', () => ({ sendPhone: vi.fn(), stopPhone: vi.fn(), watchPhone: vi.fn(), refreshPhoneChat: vi.fn(), syncPhoneHistory: vi.fn() }));
vi.mock('@/shared/overlays/controller', () => ({ toast: vi.fn(), toastError: vi.fn(), openModal: vi.fn(), closeModal: vi.fn(), confirm: vi.fn(), prompt: vi.fn(), topModal: () => S.modals.at(-1) }));
vi.mock('@/features/phones/runtime/phoneCommander', async original => ({ ...await original<object>(), commanderExtra: vi.fn(async () => ({})), ensureCommander: vi.fn() }));
const { sendToTeam } = await import('./team');
const { coreName } = await import('./coreTeam');

const buddy = { id: 'ag_buddy', name: 'CodeBuddy', backend: 'codebuddy', agent_type: 'acp', agent_source: 'builtin', enabled: true, installed: true, status: 'online' as const };
const existing = (ids: string[]) => ids.map(id => ({ id, owner: 'pc', title: id, updated: 1, remote: true, loaded: true, messages: [], teamId: 't1' }));
let team: Team;
/** 内核里现有的团队成员（GET /api/teams/core1 的返回） */
let remote: { slot_id: string; role: string; name: string; conversation_id: string }[];

beforeEach(() => {
  vi.clearAllMocks();
  S.cloud = 'signed-in'; S.account = { id: 'acc', name: 'A', email: '' }; S.convs = []; S.running = {};
  S.agentCatalog = [buddy]; S.agentPins = [];
  S.providers = [{ id: 'own', platform: 'openai', name: 'mock', base_url: 'https://x/v1', models: ['m1'], enabled: true, created_at: 1 }];
  S.model = 'own::m1'; S.permission = 'ask'; S.prefs.allowInstall = 'ask';
  team = { id: 't1', name: '批量小队', folder: '/work/team', created: 1, real: true, panes: {},
    members: [{ mid: 'l', agent: 'pc', role: '总编', leader: true }, { mid: 'a', agent: 'ag:ag_buddy', role: '执行' }, { mid: 'b', agent: 'ag:ag_buddy', role: '执行' }] };
  S.teams = [team];
  remote = [];
  m.api.mockImplementation(async (method: string, path: string, body?: Record<string, unknown>) => {
    if (method === 'GET' && path === '/api/assistants') return [{ id: 'bare:eng', source: 'generated', agent_id: 'eng', agent: { type: 'aionrs' } }];
    if (method === 'POST' && path === '/api/assistants') return { id: 'lead-asst' };
    if (method === 'POST' && path === '/api/teams') return { id: 'core1', assistants: [
      { slot_id: 's-lead', role: 'lead', name: 'Lom', conversation_id: 'lead1' },
      ...((body?.agents as { name: string }[]).slice(1).map((a, i) => ({ slot_id: `s-${i}`, role: 'teammate', name: a.name, conversation_id: `mem${i}` }))) ] };
    if (method === 'GET' && /^\/api\/teams\/core\w+$/.test(path)) return { id: path.split('/')[3], assistants: remote };
    if (method === 'POST' && /^\/api\/teams\/core\w+\/agents$/.test(path)) return { slot_id: 's-new', role: 'teammate', name: body?.name, conversation_id: 'mem-new' };
    if (method === 'GET' && path === '/api/conversations/lead1') return { id: 'lead1', type: 'aionrs', name: 'Lom', created_at: 1, modified_at: 1, model: { provider_id: 'own', model: 'm1' }, extra: {} };
    if (method === 'GET' && /^\/api\/conversations\/mem[\w-]+$/.test(path)) return { id: path.split('/')[3], type: 'acp', name: 'CodeBuddy', created_at: 1, modified_at: 1, extra: { agent_id: 'ag_buddy', backend: 'codebuddy' } };
    if (method === 'GET' && path.includes('/messages?')) return { items: [] };
    if (method === 'GET' && path.startsWith('/api/conversations/')) return { runtime: { is_processing: false }, id: path.split('/')[3], model: { provider_id: 'own', model: 'm1' } };
    return { turn_id: 'turn' };
  });
});

it('TEAM-SAME-AGENT the same Agent added twice with the same role gets two distinct core members and two conversations', async () => {
  expect(coreName(team, team.members[1])).not.toBe(coreName(team, team.members[2]));
  await sendToTeam(team, team.members[0], '开始', []);
  const created = m.api.mock.calls.find(c => c[0] === 'POST' && c[1] === '/api/teams')![2] as { agents: { name: string }[] };
  const names = created.agents.slice(1).map(a => a.name);
  expect(new Set(names).size).toBe(2);
  expect(team.core?.slots.a).not.toBe(team.core?.slots.b);
  expect(team.memberConvs?.a).toBeTruthy();
  expect(team.memberConvs?.a).not.toBe(team.memberConvs?.b);
});

it('TEAM-SAME-AGENT a member message goes to that member only, not to its twin', async () => {
  await sendToTeam(team, team.members[0], '开始', []);
  await sendToTeam(team, team.members[2], '只给第二个', []);
  const posted = m.api.mock.calls.filter(c => c[0] === 'POST' && /^\/api\/teams\/core1\/agents\/[^/]+\/messages$/.test(c[1]));
  expect(posted.map(c => c[1])).toEqual([`/api/teams/core1/agents/${team.core!.slots.b}/messages`]);
});

it('TEAM-SAME-AGENT a team created by the old version with two members sharing one core member is repaired on next use', async () => {
  team.core = { id: 'coreOld', assistant: 'lead-asst', slots: { l: 's-lead', a: 's-0', b: 's-0' } };
  team.leaderConv = 'lead1'; team.memberConvs = { a: 'mem0', b: 'mem0' }; S.convs = existing(['lead1', 'mem0', 'mem1']);
  remote = [
    { slot_id: 's-lead', role: 'lead', name: 'Lom', conversation_id: 'lead1' },
    { slot_id: 's-0', role: 'teammate', name: 'CodeBuddy·执行', conversation_id: 'mem0' },
    { slot_id: 's-1', role: 'teammate', name: 'CodeBuddy·执行', conversation_id: 'mem1' },
  ];
  await sendToTeam(team, team.members[2], '修好了吗', []);
  expect(team.core.slots).toMatchObject({ a: 's-0', b: 's-1' });
  expect(team.memberConvs).toMatchObject({ a: 'mem0', b: 'mem1' });
});

it('TEAM-SAME-AGENT when the old core has no spare twin, the member is re-added and gets its own conversation', async () => {
  team.core = { id: 'coreLost', assistant: 'lead-asst', slots: { l: 's-lead', a: 's-0', b: 's-0' } };
  team.leaderConv = 'lead1'; team.memberConvs = { a: 'mem0', b: 'mem0' }; S.convs = existing(['lead1', 'mem0', 'mem1']);
  remote = [
    { slot_id: 's-lead', role: 'lead', name: 'Lom', conversation_id: 'lead1' },
    { slot_id: 's-0', role: 'teammate', name: 'CodeBuddy·执行', conversation_id: 'mem0' },
  ];
  await sendToTeam(team, team.members[2], '修好了吗', []);
  expect(m.api.mock.calls.some(c => c[0] === 'POST' && c[1] === '/api/teams/coreLost/agents')).toBe(true);
  expect(team.core.slots.b).toBe('s-new');
  expect(team.memberConvs?.b).toBe('mem-new');
  expect(team.memberConvs?.a).toBe('mem0');
});
