import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Team } from '@/state/types';

const m = vi.hoisted(() => ({ api: vi.fn(), sendFromChannel: vi.fn(), ensureConversation: vi.fn(), assistants: [] as unknown[] }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => ({ url: 'http://core', token: 't', defaultFolder: '/work', homeDir: '/Users/me' }) }));
vi.mock('@/features/phones/runtime/phoneChat', () => ({ sendPhone: vi.fn(), stopPhone: vi.fn(), watchPhone: vi.fn(), refreshPhoneChat: vi.fn(), syncPhoneHistory: vi.fn() }));
vi.mock('@/shared/overlays/controller', () => ({ toast: vi.fn(), toastError: vi.fn(), openModal: vi.fn(), closeModal: vi.fn(), confirm: vi.fn(), prompt: vi.fn(), topModal: () => S.modals.at(-1) }));
vi.mock('@/features/phones/runtime/phoneCommander', async original => ({ ...await original<object>(), commanderExtra: vi.fn(async () => ({})), ensureCommander: vi.fn() }));
vi.mock('@/features/personal/runtime/session', () => ({ ensureConversation: m.ensureConversation }));
vi.mock('@/features/personal/runtime/catalog', async original => ({ ...await original<object>(), loadAssistants: () => ({ items: m.assistants }) }));
vi.mock('@/features/chat/runtime/tasks', async original => ({ ...await original<object>(), sendFromChannel: m.sendFromChannel }));
const { postTeamChat, retryTeamChat, sendTeamChatDraft } = await import('../actions/teamChat');
const { takeDraft } = await import('@/features/chat/actions/drafts');

const buddy = { id: 'ag_buddy', name: 'CodeBuddy', backend: 'codebuddy', agent_type: 'acp', agent_source: 'builtin', enabled: true, installed: true, status: 'online' as const };
let team: Team;
const posts = () => m.api.mock.calls.filter(c => c[0] === 'POST' && /\/messages$/.test(c[1]));

beforeEach(() => {
  vi.clearAllMocks();
  S.cloud = 'signed-in'; S.account = { id: 'acc', name: 'A', email: '' }; S.convs = []; S.running = {}; S.teamChatTargets = {};
  S.agentCatalog = [buddy]; S.agentPins = [];
  S.providers = [{ id: 'own', platform: 'openai', name: 'mock', base_url: 'https://x/v1', models: ['m1'], enabled: true, created_at: 1 }];
  S.model = 'own::m1'; S.permission = 'ask'; S.prefs.allowInstall = 'ask';
  // 两位成员是同一个 Agent、同名「CodeBuddy」，只靠 mid 区分
  team = { id: 't1', name: '调研队', folder: '/work/team', created: 1, real: true, panes: {}, ownerAccountId: 'acc',
    members: [{ mid: 'l', agent: 'pc', role: '队长', leader: true }, { mid: 'a', agent: 'ag:ag_buddy', role: '检索' }, { mid: 'b', agent: 'ag:ag_buddy', role: '分析' }] };
  S.teams = [team];
  m.assistants = [{ id: 'pa_1', name: '小鹿', directory: '/d', workspace: '/d', avatar: '02', conversation: 'pa-conv' }];
  m.api.mockImplementation(async (method: string, path: string, body?: Record<string, unknown>) => {
    if (method === 'GET' && path === '/api/assistants') return [{ id: 'bare:eng', source: 'generated', agent_id: 'eng', agent: { type: 'aionrs' } }];
    if (method === 'POST' && path === '/api/assistants') return { id: 'lead-asst' };
    if (method === 'POST' && path === '/api/teams') return { id: 'core1', assistants: [
      { slot_id: 's-lead', role: 'lead', name: 'Lom', conversation_id: 'lead1' },
      ...((body?.agents as { name: string }[]).slice(1).map((a, i) => ({ slot_id: `s-${i}`, role: 'teammate', name: a.name, conversation_id: `mem${i}` }))) ] };
    if (method === 'GET' && path === '/api/conversations/lead1') return { id: 'lead1', type: 'aionrs', name: 'Lom', created_at: 1, modified_at: 1, model: { provider_id: 'own', model: 'm1' }, extra: {} };
    if (method === 'GET' && /^\/api\/conversations\/mem\d$/.test(path)) return { id: path.split('/')[3], type: 'acp', name: 'CodeBuddy', created_at: 1, modified_at: 1, extra: { agent_id: 'ag_buddy', backend: 'codebuddy' } };
    if (method === 'GET' && path.startsWith('/api/conversations/')) return { runtime: { is_processing: false }, id: path.split('/')[3], model: { provider_id: 'own', model: 'm1' } };
    return { turn_id: 'turn' };
  });
});

it('TEAM-CHAT-01A AC-A2 AC-A6 @ the second of two same-name members reaches only that member conversation', async () => {
  const post = await postTeamChat(team, '整理一下数据', ['m:b']);
  const sent = posts();
  expect(sent.map(c => c[1])).toEqual(['/api/teams/core1/agents/s-1/messages']);
  expect(String(sent[0][2].content)).toContain(`"post":"${post.id}"`);
  expect(String(sent[0][2].content)).toMatch(/整理一下数据$/);
  expect(post.deliveries).toEqual([{ key: 'm:b', state: 'accepted', conv: 'mem1' }]);
  const userMsgs = (id: string) => S.convs.find(c => c.id === id)!.messages.filter(x => x.type === 'user');
  expect(userMsgs('mem1')).toHaveLength(1);
  expect(userMsgs('mem1')[0]).toMatchObject({ text: '整理一下数据', source: 'team_chat', teamChat: { post: post.id, team: 't1' } });
  expect(userMsgs('mem0')).toHaveLength(0);
  expect(userMsgs('lead1')).toHaveLength(0);
});

it('TEAM-CHAT-01A AC-A4 AC-A7 without a picked mention the post goes to the leader only, even if the text says @CodeBuddy', async () => {
  S.drafts['teamchat:t1'] = '@CodeBuddy 你来看看';
  await sendTeamChatDraft('teamchat:t1', '@CodeBuddy 你来看看', [], () => takeDraft('teamchat:t1'));
  expect(posts().map(c => c[1])).toEqual(['/api/teams/core1/messages']);
  expect(team.chatPosts?.[0].deliveries.map(d => d.key)).toEqual(['m:l']);
  expect(S.drafts['teamchat:t1']).toBe('');
});

it('TEAM-CHAT-01A duplicate picks deliver once; a removed member blocks sending and keeps the draft', async () => {
  const post = await postTeamChat(team, '分头查', ['m:a', 'm:a']);
  expect(posts().map(c => c[1])).toEqual(['/api/teams/core1/agents/s-0/messages']);
  expect(post.deliveries).toHaveLength(1);
  S.teamChatTargets.t1 = ['m:gone'];
  S.drafts['teamchat:t1'] = '还在吗';
  await sendTeamChatDraft('teamchat:t1', '还在吗', [], () => takeDraft('teamchat:t1'));
  expect(posts()).toHaveLength(1);
  expect(S.drafts['teamchat:t1']).toBe('还在吗');
  expect(team.chatPosts).toHaveLength(1);
});

it('TEAM-CHAT-01A AC-A5 @ the personal assistant goes only to its own conversation with the group envelope', async () => {
  team.chatAssistant = 'pa_1';
  const pa = { id: 'pa-conv', owner: 'pc', title: '小鹿', updated: 1, messages: [], remote: true, personal: { id: 'pa_1', name: '小鹿', directory: '/d' } };
  S.convs = [pa];
  m.ensureConversation.mockResolvedValue('pa-conv');
  m.sendFromChannel.mockImplementation(async (_c, text: string, source: string, _live, _d, extra) => ({ id: 'u', type: 'user', at: 1, text, source, ...extra }));
  const post = await postTeamChat(team, '帮我盯一下进度', ['pa:pa_1']);
  expect(posts()).toHaveLength(0);
  expect(m.sendFromChannel).toHaveBeenCalledTimes(1);
  const [conv, text, source, , , extra] = m.sendFromChannel.mock.calls[0];
  expect(conv).toBe(pa);
  expect([text, source]).toEqual(['帮我盯一下进度', 'team_chat']);
  expect(extra.teamChat).toMatchObject({ post: post.id, from: { kind: 'user' }, to: [{ key: 'pa:pa_1', name: '小鹿', role: '个人助理' }] });
  expect(post.deliveries).toEqual([{ key: 'pa:pa_1', state: 'accepted', conv: 'pa-conv' }]);
});

it('TEAM-CHAT-01A a busy personal assistant fails visibly instead of pretending delivery', async () => {
  team.chatAssistant = 'pa_1';
  S.convs = [{ id: 'pa-conv', owner: 'pc', title: '小鹿', updated: 1, messages: [], remote: true, personal: { id: 'pa_1', name: '小鹿', directory: '/d' } }];
  S.running['pa-conv'] = true;
  m.ensureConversation.mockResolvedValue('pa-conv');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const post = await postTeamChat(team, '再看看', ['pa:pa_1']);
  expect(m.sendFromChannel).not.toHaveBeenCalled();
  expect(post.deliveries[0]).toMatchObject({ state: 'failed' });
  expect(post.deliveries[0].error).toContain('正在处理上一条');
});

it('TEAM-CHAT-01B AC-B1 @所有人 reaches the leader and every member exactly once, never the personal assistant; retry only re-sends failures', async () => {
  team.chatAssistant = 'pa_1';
  const post = await postTeamChat(team, '各自汇报进度', ['all', 'm:a', 'all']);
  expect(posts().map(c => c[1]).sort()).toEqual(['/api/teams/core1/agents/s-0/messages', '/api/teams/core1/agents/s-1/messages', '/api/teams/core1/messages']);
  expect(m.sendFromChannel).not.toHaveBeenCalled();
  expect(post.deliveries.map(d => d.key)).toEqual(['m:l', 'm:a', 'm:b']);
  post.deliveries[2] = { key: 'm:b', state: 'failed', error: '模拟失败' };
  m.api.mockClear();
  await retryTeamChat(team, post);
  expect(posts().map(c => c[1])).toEqual(['/api/teams/core1/agents/s-1/messages']);
  expect(String(posts()[0][2].content)).toContain('"to":[{"key":"m:l"');
  expect(post.deliveries.map(d => d.state)).toEqual(['accepted', 'accepted', 'accepted']);
});
