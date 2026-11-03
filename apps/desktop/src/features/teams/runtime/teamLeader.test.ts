import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Team } from '@/state/types';

const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => ({ url: 'http://core', token: 't', defaultFolder: '/work', homeDir: '/Users/me' }) }));
vi.mock('@/features/phones/runtime/phoneChat', () => ({ sendPhone: vi.fn(), stopPhone: vi.fn(), watchPhone: vi.fn(), refreshPhoneChat: vi.fn(), syncPhoneHistory: vi.fn() }));
vi.mock('@/shared/overlays/controller', () => ({ toast: vi.fn(), toastError: vi.fn(), openModal: vi.fn(), closeModal: vi.fn(), confirm: vi.fn(), prompt: vi.fn(), topModal: () => S.modals.at(-1) }));
vi.mock('@/features/phones/runtime/phoneCommander', async original => ({ ...await original<object>(), commanderExtra: vi.fn(async () => ({})), ensureCommander: vi.fn() }));
const { sendToTeam, conversationOf, teamRules } = await import('./team');

const buddy = { id: 'ag_buddy', name: 'CodeBuddy', backend: 'codebuddy', agent_type: 'acp', agent_source: 'builtin', enabled: true, installed: true, status: 'online' as const };
let team: Team;
let sequence = 0;
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
  team.id = `select-${++sequence}`;
  S.teams = [team];
  remote = [];
  m.api.mockImplementation(async (method: string, path: string, body?: Record<string, unknown>) => {
    if (method === 'GET' && path === '/api/assistants') return [{ id: 'bare:eng', source: 'generated', agent_id: 'eng', agent: { type: 'aionrs' } }];
    if (method === 'POST' && path === '/api/assistants') return { id: 'lead-asst' };
    if (method === 'POST' && path === '/api/teams') return { id: `select-core-${sequence}`, assistants: [
      { slot_id: 's-lead', role: 'lead', name: (body?.agents as {name:string}[])[0].name, conversation_id: 'lead1' },
      ...((body?.agents as { name: string }[]).slice(1).map((a, i) => ({ slot_id: `s-${i}`, role: 'teammate', name: a.name, conversation_id: `mem${i}` }))) ] };
    if (method === 'GET' && /^\/api\/teams\/core\w+$/.test(path)) return { id: path.split('/')[3], assistants: remote };
    if (method === 'POST' && path === `/api/teams/select-core-${sequence}/agents`) return { slot_id: 's-new', role: 'teammate', name: body?.name, conversation_id: 'mem-new' };
    if (method === 'GET' && path === '/api/conversations/lead1') return { id: 'lead1', type: team.members.find(x => x.leader)?.agent === 'pc' ? 'aionrs' : 'acp', name: 'Leader', created_at: 1, modified_at: 1, model: { provider_id: 'own', model: 'm1' }, extra: {} };
    if (method === 'GET' && /^\/api\/conversations\/mem[\w-]+$/.test(path)) return { id: path.split('/')[3], type: 'acp', name: 'CodeBuddy', created_at: 1, modified_at: 1, extra: { agent_id: 'ag_buddy', backend: 'codebuddy' } };
    if (method === 'GET' && path.includes('/messages?')) return { items: [] };
    if (method === 'GET' && path.startsWith('/api/conversations/')) return { runtime: { is_processing: false }, id: path.split('/')[3], model: { provider_id: 'own', model: 'm1' } };
    return { turn_id: 'turn' };
  });
});


it('TEAM-LEADER-01 AC2 external leader uses its engine and model without requiring a Lom provider', async () => {
  team.members = [{ mid: 'a', agent: 'ag:ag_buddy', role: '主控', leader: true }, { mid: 'b', agent: 'ag:ag_buddy', role: '执行' }];
  S.providers = []; S.model = ''; S.agentModelPick.ag_buddy = 'external-model';
  expect(await sendToTeam(team, team.members[0], '开始', [])).toBe(true);
  const assistant = m.api.mock.calls.find(c => c[0] === 'POST' && c[1] === '/api/assistants')![2];
  expect(assistant.agent_id).toBe('ag_buddy');
  const created = m.api.mock.calls.find(c => c[0] === 'POST' && c[1] === '/api/teams')![2];
  expect(created.agents[0]).toMatchObject({ role: 'lead', model: 'external-model' });
  expect(new Set(created.agents.map((a: {name:string}) => a.name)).size).toBe(2);
  expect(m.api.mock.calls.find(c => c[1] === '/api/skills/assistant-rule/write')![2].content).not.toContain('只以麓鸣 Lom 的身份');
  expect(m.api.mock.calls.some(c => c[0] === 'PATCH' && c[2]?.model)).toBe(false);
  expect(m.api.mock.calls.some(c => c[1] === `/api/teams/${team.core!.id}/messages`)).toBe(true);
});
it('TEAM-LEADER-01 AC3 Lom teammate receives its own slot, model and direct messages', async () => {
  team.members = [{ mid: 'a', agent: 'ag:ag_buddy', role: '主控', leader: true }, { mid: 'l', agent: 'pc', role: '执行' }];
  await sendToTeam(team, team.members[0], '开始', []);
  expect(team.memberConvs?.l).toBe('mem0');
  expect(conversationOf(team, team.members[1])?.id).toBe('mem0');
  expect(teamRules(team)).toContain('Lom（角色：执行');
  const created = m.api.mock.calls.find(c => c[0] === 'POST' && c[1] === '/api/teams')![2];
  expect(created.agents[1]).toMatchObject({ assistant_id: 'bare:eng', role: 'teammate', model: 'm1' });
  expect(m.api.mock.calls.some(c => c[0] === 'PATCH' && c[1] === '/api/conversations/mem0' && c[2]?.model?.provider_id === 'own')).toBe(true);
  expect(await sendToTeam(team, team.members[1], '独立执行', [])).toBe(true);
  expect(m.api.mock.calls.at(-1)?.[1]).toBe(`/api/teams/${team.core!.id}/agents/s-0/messages`);
});
it('TEAM-LEADER-01 AC2 unavailable external leader fails before creating a team', async () => {
  team.members = [{ mid: 'a', agent: 'ag:missing', role: '主控', leader: true }];
  await expect(sendToTeam(team, team.members[0], '开始', [])).rejects.toThrow('主控 Agent 不可用');
  expect(m.api.mock.calls.some(c => c[0] === 'POST' && c[1] === '/api/teams')).toBe(false);
});

it('TEAM-LEADER-01 AC3 adding Lom later restores team permission mode after restarting', async () => {
  const { syncCoreMembers } = await import('./coreTeam');
  team.members = [{ mid: 'a', agent: 'ag:ag_buddy', role: '主控', leader: true }];
  await sendToTeam(team, team.members[0], '开始', []);
  const member = { mid: 'l', agent: 'pc', role: '执行' };
  team.members.push(member);
  await syncCoreMembers(team);
  expect(conversationOf(team, member)?.id).toBe('mem-new');
  await sendToTeam(team, member, '执行', []);
  expect(m.api.mock.calls.filter(c => c[1] === `/api/teams/${team.core!.id}/session-mode`)).toHaveLength(2);
});
