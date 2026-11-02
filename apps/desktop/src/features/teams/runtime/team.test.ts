import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Msg, Team } from '@/state/types';

const m = vi.hoisted(() => ({ api: vi.fn(), sendPhone: vi.fn(), commanderExtra: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => ({ url: 'http://core', token: 't', defaultFolder: '/work', homeDir: '/Users/me' }) }));
vi.mock('@/features/phones/runtime/phoneChat', () => ({ sendPhone: m.sendPhone, stopPhone: vi.fn(), watchPhone: vi.fn(), refreshPhoneChat: vi.fn(), syncPhoneHistory: vi.fn() }));
vi.mock('@/shared/overlays/controller', () => ({ toast: vi.fn(), toastError: vi.fn(), openModal: vi.fn(), closeModal: vi.fn(), confirm: vi.fn(), prompt: vi.fn(), topModal: () => S.modals.at(-1) }));
vi.mock('@/features/phones/runtime/phoneCommander', async original => ({ ...await original<object>(), commanderExtra: m.commanderExtra, ensureCommander: vi.fn() }));
const { sendToTeam, teamRules, conversationOf } = await import('./team');
const { teamSourcesOf } = await import('./teamSources');
const { executeAgentTool } = await import('@/features/phones/runtime/commanderAgents');

const kimi = { id: 'ag_kimi', name: 'Kimi', backend: 'kimi', agent_type: 'acp', agent_source: 'builtin', enabled: true, installed: true, status: 'online' as const };
const codex = { ...kimi, id: 'ag_codex', name: 'Codex CLI', backend: 'codex' };
let team: Team;

beforeEach(() => {
  vi.clearAllMocks();
  S.cloud = 'signed-in'; S.account = { id: 'acc', name: 'A', email: '' }; S.convs = []; S.running = {};
  S.agentCatalog = [kimi, codex]; S.agentPins = [];
  S.providers = [{ id: 'own', platform: 'openai', name: 'mock', base_url: 'https://x/v1', models: ['m1'], enabled: true, created_at: 1 }];
  S.model = 'own::m1'; S.permission = 'ask'; S.prefs.allowInstall = 'ask';
  S.agents.dev_r = { id: 'dev_r', kind: 'phone', name: 'REDMI', real: true, status: 'online', persona: '美妆博主' } as never;
  team = { id: 't1', name: '外卖小队', folder: '/work/team', created: 1, real: true, panes: {},
    members: [{ mid: 'l', agent: 'pc', role: '总编', leader: true }, { mid: 'p', agent: 'dev_r', role: '点外卖' }, { mid: 'k', agent: 'ag:ag_kimi', role: '看视频' }] };
  S.teams = [team];
  m.commanderExtra.mockResolvedValue({ lom_phone_scope: 'scope1', selected_mcp_server_ids: ['bridge'] });
  let n = 0;
  m.api.mockImplementation(async (method: string, path: string, body?: Record<string, unknown>) => {
    if (method === 'PATCH' && path === '/api/conversations/lead1' && ['skills', 'mcp_server_ids', 'mcp_servers', 'mcp_statuses', 'session_mcp_servers'].some(key => key in ((body?.extra as object) || {}))) throw Object.assign(new Error('extra.skills and MCP snapshots are immutable post-creation'), { status: 400 });
    // 内核团队模式（lom-core aionui-team）
    if (method === 'GET' && path === '/api/assistants') return [{ id: 'bare:eng', source: 'generated', agent_id: 'eng', agent: { type: 'aionrs' } }];
    if (method === 'POST' && path === '/api/assistants') return { id: 'lead-asst' };
    if (method === 'POST' && path === '/api/teams') return { id: 'core1', assistants: [
      { slot_id: 's-lead', role: 'lead', name: 'Lom', conversation_id: 'lead1' },
      ...((body?.agents as { name: string }[]).slice(1).map((a, i) => ({ slot_id: `s-${i}`, role: 'teammate', name: a.name, conversation_id: `mem${i}` }))) ] };
    if (method === 'POST' && path === '/api/teams/core1/agents') return { slot_id: 's-new', role: 'teammate', name: body?.name, conversation_id: 'mem-new' };
    if (method === 'GET' && path === '/api/conversations/lead1') return { id: 'lead1', type: 'aionrs', name: 'Lom', created_at: 1, modified_at: 1, model: { provider_id: 'own', model: 'm1' }, extra: { lom_phone_scope: 'scope1', skills: ['keep'], mcp_server_ids: ['bridge'], session_mcp_servers: [], mcp_statuses: [] } };
    if (method === 'GET' && /^\/api\/conversations\/mem[\w-]+$/.test(path)) return { id: path.split('/')[3], type: 'acp', name: 'Kimi', created_at: 1, modified_at: 1, extra: { agent_id: 'ag_kimi', backend: 'kimi' } };
    if (method === 'POST' && path === '/api/conversations') return { id: `c${++n}`, name: body?.name, type: body?.type, created_at: 1, modified_at: 1, extra: body?.extra, model: body?.model };
    if (method === 'GET' && path.includes('/messages?')) {
      const c = S.convs.find(c => c.id === path.split('/')[3]);
      return { items: c?.messages.filter(m => m.type === 'assistant').map(m => ({ id: m.id, type:'text', position:'left', created_at:m.at, content:{content:m.text} })) || [] };
    }
    if (method === 'GET' && path.startsWith('/api/conversations/')) return { runtime:{is_processing:false}, id: path.split('/')[3], model: { provider_id: 'own', model: 'm1' } };
    return { turn_id: 'turn' };
  });
});
const calls = (method: string, path: string) => m.api.mock.calls.filter(c => c[0] === method && c[1] === path);

/** D32：一条搜索工具消息；results 足够让 D31 解析器还原来源 */
const search = (id: string, at: number, urls: string[], status: Msg['status'] = 'done'): Msg => ({
  id, type: 'tool', at, status, toolName: 'LomWebSearch',
  output: JSON.stringify({
    result: {
      query: '事实核查',
      results: urls.map(url => ({ title: `来源 ${url}`, url, site: new URL(url).hostname })),
    },
  }),
});

it('OPC leader prompt maps capabilities first and tells desktop agents to talk to each other with team tools', () => {
  const r = teamRules(team);
  expect(r).toContain('开图');
  expect(r).toContain('TEAM.md');
  expect(r).toContain('phone_apps');
  expect(r).toContain('美团');
  expect(r).toContain('REDMI（角色：点外卖；手机，设备 ID dev_r');
  expect(r).toContain('Kimi（角色：看视频；电脑上的 Agent，团队成员，用 team_* 工具协作');
  expect(r).toContain('team_send_message');
  expect(r).toContain('team_task_create');
  expect(r).toContain('不必每条都回复');
});

it('OPC the leader pane builds one kernel team (Lom lead with the team phones + Kimi) and keeps using it', async () => {
  await sendToTeam(team, team.members[0], '帮我点一份外卖', []);
  expect(calls('POST', '/api/assistants')[0][2]).toMatchObject({ agent_id: 'eng', defaults: { mcps: { mode: 'fixed', value: ['bridge'] } } });
  expect(calls('POST', '/api/skills/assistant-rule/write')[0][2]).toMatchObject({ assistant_id: 'lead-asst', content: expect.stringContaining('开图') });
  expect(calls('POST', '/api/teams')[0][2]).toMatchObject({ name: '外卖小队', workspace: '/work/team', agents: [
    { assistant_id: 'lead-asst', role: 'lead', model: 'm1' }, { assistant_id: 'bare:ag_kimi', name: 'Kimi', role: 'teammate' }] });
  expect(calls('PATCH', '/api/conversations/lead1')[0][2]).toMatchObject({ extra: { lom_phone_scope: 'scope1' } });
  expect(team.core).toMatchObject({ id: 'core1', assistant: 'lead-asst', slots: { l: 's-lead', k: 's-0' } });
  expect(team.leaderConv).toBe('lead1');
  expect(team.memberConvs?.k).toBe('mem0');
  expect(S.convPhones.lead1).toEqual(['dev_r']);
  expect(S.convs.find(c => c.id === 'lead1')).toMatchObject({ teamId: 't1', phoneScope: 'scope1' });
  expect(calls('POST', '/api/teams/core1/messages')[0][2].content).toContain('帮我点一份外卖');
  // 内核团队默认全自动：第一次发送前先按「每次询问」等用户设置改过来
  const order = m.api.mock.calls.map(c => c[1]);
  expect(calls('POST', '/api/teams/core1/session-mode')[0][2]).toEqual({ mode: 'default' });
  expect(order.indexOf('/api/teams/core1/session-mode')).toBeLessThan(order.indexOf('/api/teams/core1/messages'));
  await sendToTeam(team, team.members[0], '再加一杯奶茶', []);
  expect(calls('POST', '/api/teams')).toHaveLength(1);
  expect(conversationOf(team, team.members[0])?.messages.map(x => x.text)).toEqual(['帮我点一份外卖', '再加一杯奶茶']);
});

it('OPC a desktop agent pane writes straight to that member; the leader no longer opens side tasks for members', async () => {
  await sendToTeam(team, team.members[2], '写一段提示词发给 Lom', []);
  expect(calls('POST', '/api/teams/core1/agents/s-0/messages')[0][2].content).toContain('写一段提示词发给 Lom');
  expect(S.running.mem0).toBe(true);
  const leader = S.convs.find(c => c.id === team.leaderConv)!;
  const listed = await executeAgentTool(leader, 'agent_list', {});
  expect(JSON.parse(listed!.content[0].text)).toEqual([{ id: 'ag:ag_kimi', name: 'Kimi', specialty: expect.stringContaining('看视频'), available: true }]);
  await expect(executeAgentTool(leader, 'agent_task_start', { agent: 'ag:ag_kimi', text: '总结这个视频' })).rejects.toThrow('team_task_create');
  expect(calls('POST', '/api/conversations')).toHaveLength(0);
});

it('OPC a message from another member shows as a card in the receiving pane (live event and history)', async () => {
  const { handleCoreEvent } = await import('@/features/chat/runtime/stream');
  const { mapHistory } = await import('@/features/chat/runtime/history');
  await sendToTeam(team, team.members[2], '在吗', []);
  handleCoreEvent({ name: 'team.teammateMessage', data: { conversation_id: 'mem0', msg_id: 'tm1', from_name: 'Lom', content: '帮我写三句开场白' } } as never);
  handleCoreEvent({ name: 'team.teammateMessage', data: { conversation_id: 'mem0', msg_id: 'tm2', from_name: 'team_system', content: 'idle' } } as never);
  expect(S.convs.find(c => c.id === 'mem0')!.messages.filter(x => x.type === 'teammate')).toEqual([expect.objectContaining({ agent: 'Lom', text: '帮我写三句开场白' })]);
  const { messages } = mapHistory([{ id: 'r1', msg_id: 'tm1', type: 'text', position: 'left', created_at: 1, content: { content: '帮我写三句开场白', teammate_message: true, sender_name: 'Lom' } }] as never, S.convs[0]);
  expect(messages).toEqual([expect.objectContaining({ type: 'teammate', agent: 'Lom' })]);
});

it('OPC member edits sync to the kernel team and the leader gets the new roster', async () => {
  const { syncCoreMembers } = await import('./coreTeam');
  await sendToTeam(team, team.members[0], '开工', []);
  m.api.mockClear();
  team.members = [team.members[0], team.members[1], { mid: 'c', agent: 'ag:ag_codex', role: '电脑操作' }];
  await syncCoreMembers(team);
  expect(calls('DELETE', '/api/teams/core1/agents/s-0')).toHaveLength(1);
  expect(calls('POST', '/api/teams/core1/agents')[0][2]).toMatchObject({ assistant_id: 'bare:ag_codex', name: 'Codex CLI' });
  expect(team.core?.slots).toEqual({ l: 's-lead', c: 's-new' });
  expect(team.memberConvs?.c).toBe('mem-new');
  expect(calls('POST', '/api/skills/assistant-rule/write')[0][2].content).toContain('Codex CLI（角色：电脑操作');
});

it('OPC stopping the team cancels the whole kernel team run; a half-built team is removed from the kernel', async () => {
  const { stopCoreTeam } = await import('./coreTeam');
  await sendToTeam(team, team.members[0], '开工', []);
  const base = m.api.getMockImplementation()!;
  m.api.mockImplementation(async (method: string, path: string, body?: Record<string, unknown>) =>
    path === '/api/teams/core1/run-state' ? { active_run: { team_run_id: 'run9' } } : base(method, path, body));
  expect(await stopCoreTeam(team)).toMatchObject({ stopped: true });
  expect(calls('POST', '/api/teams/core1/runs/run9/cancel')).toHaveLength(1);

  delete team.core; m.api.mockClear();
  m.api.mockImplementation(async (method: string, path: string, body?: Record<string, unknown>) => {
    if (method === 'PATCH') throw new Error('patch failed');
    return base(method, path, body);
  });
  await expect(sendToTeam(team, team.members[0], '再来', [])).rejects.toThrow('patch failed');
  await vi.waitFor(() => expect(calls('DELETE', '/api/teams/core1')).toHaveLength(1));
  expect(calls('DELETE', '/api/assistants/lead-asst')).toHaveLength(1);
  expect(team.core).toBeUndefined();
});

it('OPC a team made before kernel teams still reads its own agent tasks, but not other tasks', async () => {
  const leader = { id: 'old_leader', owner: 'pc', title: 'Leader', updated: 1, teamId: 't1', remote: true, messages: [] };
  S.convs.push(leader);
  team.leaderConv = 'old_leader';
  // 重启后内存里的派发记录没了，只剩会话本身
  S.convs.push({ id: 'old_kimi', owner: 'pc', title: 'Kimi', updated: 1, teamId: 't1', agentId: 'ag_kimi', messages: [{ id: 'a', type: 'assistant', at: 1, text: '上次的结果' }] });
  S.convs.push({ id: 'private', owner: 'pc', title: '别的任务', updated: 1, agentId: 'ag_kimi', messages: [] });
  const read = JSON.parse((await executeAgentTool(leader, 'agent_task_read', { task_id: 'old_kimi' }))!.content[0].text);
  expect(read.output).toContain('上次的结果');
  await expect(executeAgentTool(leader, 'agent_task_read', { task_id: 'private' })).rejects.toThrow('不是当前任务');
});

it('OPC a phone member pane sends straight to that phone', async () => {
  await sendToTeam(team, team.members[1], '看看美团登录了没', []);
  expect(m.sendPhone).toHaveBeenCalledTimes(1);
  expect(conversationOf(team, team.members[1])).toMatchObject({ owner: 'dev_r', teamId: 't1' });
});

it('D16 management edits a copy, removes a member, retains history and repairs focus', async () => {
  const { addMember, removeAssist, saveMembers } = await import('../actions/teams');
  team.leaderConv = 'leader'; team.memberConvs = { k:'kimi-history' }; S.teamFocus = 'k';
  S.modals = [{type:'team', props:{mode:'add',id:team.id}}] as never;
  addMember(team.id); removeAssist('k');
  expect(team.members).toHaveLength(3);
  saveMembers(); expect(team.members.map(m => m.mid)).toEqual(['l','p']);
  expect(team.memberConvs.k).toBe('kimi-history'); expect(S.teamFocus).toBe('l'); expect(S.convPhones.leader).toEqual(['dev_r']);
});
it('D16 keeps Leader and refuses to change a running team', async () => {
  const { addMember, removeAssist, saveMembers } = await import('../actions/teams');
  S.modals = [{type:'team', props:{mode:'add',id:team.id}}] as never;
  addMember(team.id); removeAssist('l'); expect(S.form.members).toHaveLength(3);
  removeAssist('k'); S.convs = [{id:'busy',teamId:team.id}] as never; S.running.busy = true;
  saveMembers(); expect(team.members).toHaveLength(3);
});

it.each([0, 2])('D16 edited messages in team pane %s use the team transport and keep the original', async memberIndex => {
  const { resendEditedMessage } = await import('@/features/chat/actions/message');
  await sendToTeam(team, team.members[memberIndex], '原来的问题', []);
  const c = conversationOf(team, team.members[memberIndex])!;
  const original = c.messages.find(x => x.type === 'user')!;
  S.running = {}; m.api.mockClear();
  expect(await resendEditedMessage(`conv:${c.id}`, original, '修改后的问题')).toBe(true);
  const endpoint = memberIndex === 0 ? '/api/teams/core1/messages' : `/api/teams/core1/agents/${team.core!.slots[team.members[memberIndex].mid]}/messages`;
  expect(calls('POST', endpoint)[0][2].content).toContain('修改后的问题');
  expect(calls('POST', `/api/conversations/${c.id}/messages`)).toHaveLength(0);
  expect(original.text).toBe('原来的问题');
  expect(c.messages.filter(x => x.type === 'user')).toHaveLength(2);
});

it('D16 a prefixed phone-member edit reaches the phone and respects its running state', async () => {
  const { resendEditedMessage } = await import('@/features/chat/actions/message');
  await sendToTeam(team, team.members[1], '原来的问题', []);
  const c = conversationOf(team, team.members[1])!; c.phoneSession = 'phone-session';
  const original = { id: 'u', type: 'user' as const, at: 1, text: '原来的问题' };
  m.sendPhone.mockClear();
  expect(await resendEditedMessage(`conv:${c.id}`, original, '修改后')).toBe(true);
  expect(m.sendPhone).toHaveBeenCalledWith(c, '修改后');
  S.running[c.id] = true; m.sendPhone.mockClear();
  await expect(resendEditedMessage(`conv:${c.id}`, original, '再修改')).rejects.toThrow('请等待');
  expect(m.sendPhone).not.toHaveBeenCalled();
});

it('D16 failed team edits preserve the original and can be retried in the same member pane', async () => {
  const { resendEditedMessage } = await import('@/features/chat/actions/message');
  await sendToTeam(team, team.members[2], '原来的问题', []);
  const c = conversationOf(team, team.members[2])!, original = c.messages[0];
  S.running = {};
  m.api.mockRejectedValueOnce(new Error('offline'));
  expect(await resendEditedMessage(`conv:${c.id}`, original, '修改后')).toBe(false);
  expect(original.text).toBe('原来的问题'); expect(S.running[c.id]).toBeUndefined();
  expect(await resendEditedMessage(`conv:${c.id}`, original, '修改后')).toBe(true);
});

it('D16 regenerate in a prefixed team pane sends the previous question through its team mailbox', async () => {
  const { regenerate } = await import('@/features/chat/actions/composer');
  await sendToTeam(team, team.members[2], '重新回答这个问题', []);
  const c = conversationOf(team, team.members[2])!;
  const reply = { id: 'reply', type: 'assistant' as const, at: 2, text: '旧回答' };
  c.messages.push(reply); S.running = {}; m.api.mockClear();
  await regenerate(`conv:${c.id}`, reply);
  expect(calls('POST', '/api/teams/core1/agents/s-0/messages')[0][2].content).toContain('重新回答这个问题');
  expect(calls('POST', `/api/conversations/${c.id}/messages`)).toHaveLength(0);
});

it('D16 prefixed team approval waits for the real confirmation and does not change global permissions', async () => {
  const { approve } = await import('@/features/chat/actions/composer');
  await sendToTeam(team, team.members[2], '做任务', []);
  const c = conversationOf(team, team.members[2])!;
  const approval: Msg = { id: 'approval', type: 'approval', at: 2, status: 'pending', confirmId: 'confirm', callId: 'call', confirmationEngine: 'acp',
    confirmationOptions: [{ label: 'Always', value: 'kimi_always', action: 'always' }] };
  c.messages.push(approval);
  let resolve!: (value: unknown) => void;
  m.api.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const pending = approve(`conv:${c.id}`, approval, 'always');
  expect(approval.status).toBe('submitting'); expect(S.permission).toBe('ask');
  expect(calls('POST', `/api/conversations/${c.id}/confirmations/call/confirm`).at(-1)![2]).toMatchObject({ msg_id: 'confirm', data: { value: 'kimi_always' } });
  resolve({}); await pending;
  expect(approval.status).toBe('approved'); expect(S.permission).toBe('ask');
});

it('D16 failed or stale team approvals cannot falsely mark a card as approved', async () => {
  const { approve } = await import('@/features/chat/actions/composer');
  await sendToTeam(team, team.members[2], '做任务', []);
  const c = conversationOf(team, team.members[2])!;
  const approval: Msg = { id: 'approval', type: 'approval', at: 2, status: 'pending', confirmId: 'confirm', callId: 'call', confirmationEngine: 'acp',
    confirmationOptions: [{ label: 'Once', value: 'kimi_once', action: 'once' }] };
  c.messages.push(approval);
  m.api.mockRejectedValueOnce(new Error('offline'));
  await approve(`conv:${c.id}`, approval, '1');
  expect(approval.status).toBe('pending');
  await approve('conv:missing', approval, 'always');
  expect(approval.status).toBe('pending'); expect(S.permission).toBe('ask');
});

it('audit G01: two panes sending first at the same time build one kernel team', async () => {
  const { ensureCoreTeam } = await import('./coreTeam');
  const [a, b] = await Promise.all([ensureCoreTeam(team), ensureCoreTeam(team)]);
  expect(a).toBe(b);
  expect(calls('POST', '/api/teams')).toHaveLength(1);
});

it('audit G02: a failed member sync stays pending and is retried before the next send', async () => {
  const { syncCoreMembers } = await import('./coreTeam');
  await sendToTeam(team, team.members[0], '开工', []);
  const base = m.api.getMockImplementation()!;
  team.members = [team.members[0], team.members[1], { mid: 'c', agent: 'ag:ag_codex', role: '电脑操作' }];
  m.api.mockImplementation(async (method: string, path: string, body?: Record<string, unknown>) => {
    if (method === 'POST' && path === '/api/teams/core1/agents') throw new Error('core busy');
    return base(method, path, body);
  });
  await expect(syncCoreMembers(team)).rejects.toThrow('core busy');
  expect(team.core?.pendingSync).toBe(true);
  m.api.mockImplementation(base); m.api.mockClear();
  await sendToTeam(team, team.members[0], '继续', []);
  expect(calls('POST', '/api/teams/core1/agents')).toHaveLength(1);
  expect(team.core?.pendingSync).toBe(false);
  expect(team.core?.slots.c).toBe('s-new');
});

it('audit G03: disbanding keeps the team when the kernel delete fails, and removes it once the kernel confirms', async () => {
  const { confirm } = await import('@/shared/overlays/controller');
  const { deleteTeam } = await import('../actions/teams');
  await sendToTeam(team, team.members[0], '开工', []);
  const base = m.api.getMockImplementation()!;
  m.api.mockImplementation(async (method: string, path: string, body?: Record<string, unknown>) => {
    if (method === 'DELETE' && path === '/api/teams/core1') throw Object.assign(new Error('network'), { status: 0 });
    return base(method, path, body);
  });
  deleteTeam('t1');
  await (vi.mocked(confirm).mock.calls.at(-1)![0].onOk as () => Promise<void>)();
  expect(S.teams.map(t => t.id)).toEqual(['t1']);
  m.api.mockImplementation(base);
  deleteTeam('t1');
  await (vi.mocked(confirm).mock.calls.at(-1)![0].onOk as () => Promise<void>)();
  expect(S.teams).toHaveLength(0);
  expect(calls('DELETE', '/api/assistants/lead-asst')).toHaveLength(1);
});

it('D32 team rules require parallel retrieval, source URLs and consensus labels', () => {
  const rules = teamRules(team);
  expect(rules).toContain('3–5 名成员并行');
  expect(rules).toContain('lom_search');
  expect(rules).toContain('LomWebSearch');
  expect(rules).toContain('来源 URL');
  expect(rules).toContain('一致');
  expect(rules).toContain('冲突');
  expect(rules).toContain('仅一家');
  expect(rules).toContain('不得当作共识');
});

it('D32 aggregates this round sources by URL and keeps member attribution', () => {
  team.leaderConv = 'lead1';
  team.memberConvs = { p: 'phone1', k: 'kimi1' };
  S.convs = [
    { id: 'lead1', owner: 'pc', title: 'Leader', updated: 2, remote: true, messages: [
      { id: 'u', type: 'user', at: 100, text: '查一下这个事实' },
      search('l1', 110, ['https://a.example/1']),
    ] },
    { id: 'phone1', owner: 'dev_r', title: 'REDMI', updated: 2, remote: true, teamId: 't1', messages: [
      search('p1', 120, ['https://a.example/1', 'https://www.b.example/1']),
    ] },
    { id: 'kimi1', owner: 'pc', title: 'Kimi', updated: 2, remote: true, teamId: 't1', agentId: 'ag_kimi', messages: [
      search('old', 50, ['https://old.example/1']),
      search('k1', 130, ['https://c.example/1']),
      search('failed', 140, ['https://failed.example/1'], 'error'),
    ] },
  ];

  const summary = teamSourcesOf(team);
  expect(summary.sources.map(s => s.url)).toEqual([
    'https://a.example/1', 'https://www.b.example/1', 'https://c.example/1',
  ]);
  expect(summary.sources[0].members).toEqual(['Lom', 'REDMI']);
  expect(summary.sources[1].members).toEqual(['REDMI']);
  expect(summary.sources[2].members).toEqual(['Kimi']);
  expect(summary.siteCount).toBe(3);
});

it('D32 shows no team sources until the current leader request exists', () => {
  team.leaderConv = 'lead1';
  S.convs = [{ id: 'lead1', owner: 'pc', title: 'Leader', updated: 2, remote: true, messages: [
    search('l1', 110, ['https://a.example/1']),
  ] }];
  expect(teamSourcesOf(team)).toEqual({ sources: [], siteCount: 0 });

  S.convs[0].messages.push({ id: 'u', type: 'user', at: 100, text: '现在再查' });
  expect(teamSourcesOf(team).sources).toHaveLength(1);
});

it('D33-UX-02 team creation never PATCHes immutable skills or MCP snapshots', async () => {
  await sendToTeam(team, team.members[0], '开始', []);
  const patches = m.api.mock.calls.filter(c => c[0] === 'PATCH' && c[1] === '/api/conversations/lead1');
  expect(patches.length).toBeGreaterThan(0);
  for (const request of patches) {
    const extra = request[2].extra || {};
    for (const key of ['skills', 'mcp_server_ids', 'mcp_servers', 'session_mcp_servers', 'mcp_statuses']) expect(extra).not.toHaveProperty(key);
  }
});
