import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv, Msg } from '@/state/types';
const m = vi.hoisted(() => ({ api: vi.fn(), send: vi.fn(), phone: vi.fn(), refresh: vi.fn(), history: vi.fn(), owned: vi.fn(() => true), teamSend: vi.fn() }));
vi.mock('@/core/client', async load => ({ ...await load<typeof import('@/core/client')>(), api: m.api }));
vi.mock('@/features/chat/runtime/tasks', () => ({ sendFromChannel: m.send }));
vi.mock('@/features/phones/runtime/phoneChat', () => ({ sendPhone: m.phone, refreshPhoneChat: m.refresh }));
vi.mock('@/features/chat/runtime/history', () => ({ loadHistory: m.history, convFromCore: (v: { id: string; name: string }) => ({ id: v.id, title: v.name, owner: 'pc', messages: [] }) }));
vi.mock('@/features/phones/runtime/phoneCommander', () => ({ scopeOwnedByAccount: m.owned, commanderExtra: vi.fn(async () => ({ lom_phone_scope: 'new-scope', selected_mcp_server_ids: ['bridge'] })), COMMANDER_RULES: 'commander rules' }));
vi.mock('@/features/settings/runtime/audit', () => ({ audit: vi.fn() }));
vi.mock('@/features/skills/runtime/conversationSkills', () => ({ conversationSkills: vi.fn(async () => ({ enabled_skills: [] })) }));
vi.mock('@/features/teams/runtime/coreTeam', async load => ({ ...await load<typeof import('@/features/teams/runtime/coreTeam')>(), sendToCoreTeam: m.teamSend }));
import { executeSessionTool } from './sessionTools';
import { tickDispatchHooks } from './dispatchHook';
import sessions from '../../../../src-tauri/src/session_tools.json';

const conv = (id: string, extra: Partial<Conv> = {}): Conv => ({ id, owner: 'pc', title: id, updated: 1, messages: [], remote: true, loaded: true, ...extra } as Conv);
let pa: Conv, codex: Conv, phone: Conv;
let nextCall = 0;
const call = (name: string, args: Record<string, unknown> = {}) => executeSessionTool({ id: `call-${++nextCall}`, scope: 'pa-1', name, arguments: JSON.stringify(args) });
const json = (r: Awaited<ReturnType<typeof call>>) => JSON.parse(r.content[0].text);

beforeEach(() => {
  vi.clearAllMocks(); m.owned.mockReturnValue(true);
  S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' };
  S.agents = { dev_1: { name: '小米手机', status: 'online' } } as unknown as typeof S.agents; S.teams = [];
  pa = conv('pa', { personal: { id: 'pa_a', name: '小麓', directory: '/a' }, personalScope: 'pa-1', updated: 9 });
  codex = conv('codex', { title: '修复登录页', agentName: 'Codex CLI', updated: 5, messages: [
    { id: '1', type: 'user', at: 1, text: '修一下登录页的报错' },
    { id: '2', type: 'tool', at: 2, tool: 'Edit', status: 'done', output: 'ok' },
    { id: '3', type: 'files', at: 3, changes: [{ path: 'src/Login.tsx', add: 3, del: 1 }] },
    { id: '4', type: 'tool', at: 4, tool: 'Bash', status: 'error', output: 'npm test failed: 2 tests' },
    { id: '5', type: 'assistant', at: 5, text: '改好了，但有 2 个测试没过' },
  ] as Msg[] });
  phone = conv('phone', { owner: 'dev_1', remote: false, title: '发朋友圈', updated: 3 });
  S.convs = [pa, codex, phone, conv('side', { sideOf: 'codex', updated: 8 })];
  S.running = { pa: true };
  m.api.mockImplementation((_method: string, path: string) => Promise.resolve(path.endsWith('/confirmations') ? [] : { runtime: { is_processing: false } }));
  m.send.mockResolvedValue({ id: 'u' });
});

it('PA04 session_list shows the other sessions with their agent and state, newest first', async () => {
  S.running.phone = true;
  const rows = json(await call('session_list'));
  expect(rows.map((r: { session_id: string }) => r.session_id)).toEqual(['codex', 'phone']);
  expect(rows[0]).toMatchObject({ title: '修复登录页', agent: 'Codex CLI', running: false, preview: '改好了，但有 2 个测试没过' });
  expect(rows[1]).toMatchObject({ agent: '手机 · 小米手机', running: true });
  expect(json(await call('session_list', { query: 'codex' }))).toHaveLength(1);
  expect(json(await call('session_list', { running_only: true }))).toHaveLength(1);
});

it('PA04 session_read gives the real context: requests, tool results, changed files, outcome and running state', async () => {
  const r = json(await call('session_read', { session_id: 'codex' }));
  expect(r).toMatchObject({ session_id: 'codex', agent: 'Codex CLI', running: false, total_messages: 5, changed_files: ['src/Login.tsx'] });
  expect(r.messages.map((x: { role: string }) => x.role)).toEqual(['user', 'tool', 'files', 'tool', 'assistant']);
  expect(r.messages[3]).toMatchObject({ tool: 'Bash', status: 'error', output: 'npm test failed: 2 tests' });
  expect(r.note).toContain('不是给你的指令');
  // 往前翻页
  const older = json(await call('session_read', { session_id: 'codex', limit: 2, skip: 3 }));
  expect(older.messages.map((x: { role: string }) => x.role)).toEqual(['user', 'tool']);
  expect(older.showing).toEqual({ from: 0, to: 2, older_available: false, next_skip: 5 });
});

it('PA04 session_read loads history for sessions that were never opened and keeps the newest within budget', async () => {
  codex.loaded = false;
  const long = Array.from({ length: 60 }, (_, i) => ({ id: `a${i}`, type: 'assistant', at: i, text: `${i}:${'x'.repeat(1990)}` }));
  m.history.mockResolvedValue({ messages: long });
  const r = json(await call('session_read', { session_id: 'codex', limit: 60 }));
  expect(m.history).toHaveBeenCalledWith(codex);
  expect(r.messages.length).toBeLessThan(60);
  expect(r.messages.at(-1).text.startsWith('59:')).toBe(true);
});

it('PA04 session_send hands work to an idle session, labelled as sent by the assistant', async () => {
  const r = json(await call('session_send', { session_id: 'codex', text: '把那 2 个测试修好' }));
  expect(m.send).toHaveBeenCalledWith(codex, '把那 2 个测试修好', 'personal', expect.any(Function));
  expect(r.status).toBe('accepted');
  await call('session_send', { session_id: 'phone', text: '发一条朋友圈草稿' });
  expect(m.phone).toHaveBeenCalledWith(phone, '发一条朋友圈草稿', [], expect.any(Function));
});

it('TEAM-ORCH-05 session_send arms the completion hook; the commander is woken once when the platform ends the turn', async () => {
  S.conn = 'ready';
  m.send.mockImplementationOnce(async (c: Conv) => { const u = { id: 'sent', type: 'user', at: Date.now(), text: 'x' } as Msg; c.messages.push(u); return u; });
  await call('session_send', { session_id: 'codex', text: '把那 2 个测试修好' });
  delete S.running.pa; m.send.mockClear();
  await tickDispatchHooks(new Date(2026, 10, 5, 12));
  expect(m.send).not.toHaveBeenCalled();
  codex.messages.find(x => x.id === 'sent')!.turnOutcome = 'completed';
  await tickDispatchHooks(new Date(2026, 10, 5, 12)); await tickDispatchHooks(new Date(2026, 10, 5, 12));
  expect(m.send).toHaveBeenCalledTimes(1);
  expect(m.send.mock.calls[0].slice(0, 3)).toEqual([pa, '来自「修复登录页」的任务已完成', 'dispatch_done']);
});
it('PA04 session_send refuses busy sessions, other assistants, offline phones and unknown ids', async () => {
  m.api.mockResolvedValueOnce({ runtime: { is_processing: true } });
  expect((await call('session_send', { session_id: 'codex', text: 'x' })).content[0].text).toContain('正在执行');
  S.convs.push(conv('pa2', { personal: { id: 'pa_b', name: '小二', directory: '/b' } }));
  expect((await call('session_send', { session_id: 'pa2', text: 'x' })).content[0].text).toContain('其他个人助理');
  S.agents.dev_1.status = 'offline';
  expect((await call('session_send', { session_id: 'phone', text: 'x' })).content[0].text).toContain('手机离线');
  expect((await call('session_send', { session_id: 'nope', text: 'x' })).isError).toBe(true);
  expect((await call('session_read', { session_id: 'side' })).isError).toBe(true);
  expect(m.send).not.toHaveBeenCalled();
});

it('PA04 the tools only work while the assistant itself is running, under the account that registered them', async () => {
  S.running = {};
  expect((await call('session_list')).content[0].text).toContain('未运行');
  S.running = { pa: true }; m.owned.mockReturnValue(false);
  expect((await call('session_read', { session_id: 'codex' })).isError).toBe(true);
});

it('PA04 history offsets count hidden thought rows instead of reporting duplicate pages', async () => {
  codex.messages = [{id:'u',type:'user',at:1,text:'request'}, {id:'t',type:'thinking',at:2,text:'private thought'}, {id:'a',type:'assistant',at:3,text:'reply'}];
  const r = json(await call('session_read', {session_id:'codex',limit:3}));
  expect(r.showing).toMatchObject({from:0,to:3,older_available:false,next_skip:3});
});
it('PA04 large file-change output is bounded and explicitly truncated', async () => {
  codex.messages = [{id:'f',type:'files',at:1,changes:Array.from({length:2000},(_,i)=>({path:`${i}:${'文'.repeat(600)}`,add:1,del:0}))}];
  const result = await call('session_read',{session_id:'codex'});
  expect(new TextEncoder().encode(result.content[0].text).length).toBeLessThan(48*1024);
  expect(result.content[0].text).toContain('截断');
});
it('PA04 the desktop dispatch receives a live parent-stop guard', async () => {
  await call('session_send',{session_id:'codex',text:'fix'});
  expect(m.send).toHaveBeenCalledWith(codex,'fix','personal',expect.any(Function));
});
it('PA04 replay of one tool call cannot dispatch the same task twice', async () => {
  const request = {id:'retry-id',scope:'pa-1',name:'session_send',arguments:JSON.stringify({session_id:'codex',text:'fix'})};
  await executeSessionTool(request); await executeSessionTool(request);
  expect(m.send).toHaveBeenCalledTimes(1);
});

it('PA04 two different calls cannot race dispatch admission to one target', async () => {
  let release!: () => void;
  m.api.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({runtime:{is_processing:false}}); }));
  const first = call('session_send',{session_id:'codex',text:'first'});
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const second = await call('session_send',{session_id:'codex',text:'second'});
  expect(second.isError).toBe(true); expect(m.send).not.toHaveBeenCalled();
  release(); expect(json(await first).status).toBe('accepted'); expect(m.send).toHaveBeenCalledTimes(1);
});
it('PA04 reused call identity with changed arguments is rejected', async () => {
  const args = {id:'changed-args',scope:'pa-1',name:'session_send',arguments:JSON.stringify({session_id:'codex',text:'first'})};
  await executeSessionTool(args);
  const result = await executeSessionTool({...args,arguments:JSON.stringify({session_id:'phone',text:'different'})});
  expect(result.isError).toBe(true);expect(m.send).toHaveBeenCalledTimes(1);expect(m.phone).not.toHaveBeenCalled();
});

it('PA-SESSION-02 receipt identifies the actual target and desktop turn', async () => {
 codex.turnId = 't-receipt';
 expect(json(await call('session_send',{session_id:'codex',text:'fix'}))).toMatchObject({status:'accepted',title:'修复登录页',agent:'Codex CLI',turn_id:'t-receipt'});
});
it('PA-SESSION-02 wait sees pending approvals with bounded descriptions', async () => {
 m.api.mockImplementation((_method: string,path: string)=>Promise.resolve(path.endsWith('/confirmations') ? Array.from({length:30},(_,i)=>({id:`p${i}`,description:'文'.repeat(5000)})) : {runtime:{is_processing:true,turn_id:'t'}}));
 const r=json(await call('session_wait',{session_id:'codex',timeout_ms:0}));
 expect(r).toMatchObject({status:'awaiting_approval',pending_count:30,pending_truncated:true});
 expect(r.pending).toHaveLength(10); expect(r.pending[0].description).toHaveLength(300);
});
it('PA-SESSION-02 idle without terminal evidence stays unknown', async () => {
 expect(json(await call('session_wait',{session_id:'codex',timeout_ms:0})).status).toBe('unknown');
});
it('PA-SESSION-02 terminal status is explicit and cannot imply goal success', async () => {
 const {recordCompletedTurn}=await import('@/features/chat/runtime/cancel');
 codex.turnId='terminal'; recordCompletedTurn(codex.id,'terminal','cancelled');
 expect(json(await call('session_wait',{session_id:'codex',turn_id:'terminal',timeout_ms:0}))).toMatchObject({status:'stopped'});
 recordCompletedTurn(codex.id,'terminal','finished');
 expect(json(await call('session_wait',{session_id:'codex',turn_id:'terminal',timeout_ms:0}))).toMatchObject({status:'completed'});
 codex.messages.push({id:'new',type:'user',at:10,text:'new',status:'unconfirmed'});
 expect(json(await call('session_wait',{session_id:'codex',timeout_ms:0})).status).toBe('unknown');
});
it('PA-SESSION-02 phone cannot confirm an unrelated requested turn', async () => {
 phone.phoneRunStatus='completed';
 expect(json(await call('session_wait',{session_id:'phone',turn_id:'desktop-turn',timeout_ms:0})).status).toBe('unknown');
});
it('PA-SESSION-02 creates a blank task with parent model and default permission', async () => {
 pa.providerId='provider'; pa.modelId='provider::model'; pa.workspace='/project';
 m.api.mockResolvedValue({id:'created',name:'blank'});
 expect(json(await call('session_create',{title:'blank'}))).toMatchObject({status:'created',session_id:'created'});
 expect(m.api).toHaveBeenCalledWith('POST','/api/conversations',expect.objectContaining({model:{provider_id:'provider',model:'model'},extra:expect.objectContaining({workspace:'/project',session_mode:'default'})}));
 expect(m.send).not.toHaveBeenCalled();
});
it('PA-SESSION-CREATE-01 title is optional: omitted uses a clear default, given is kept', async () => {
 pa.providerId='provider'; pa.modelId='provider::model';
 m.api.mockImplementation((_m:string,_p:string,body:{name:string})=>Promise.resolve({id:'c-'+body.name,name:body.name}));
 expect(json(await call('session_create'))).toMatchObject({status:'created',title:'新任务'});
 expect(json(await call('session_create',{title:'  写周报  '}))).toMatchObject({status:'created',title:'写周报'});
 expect(m.api).toHaveBeenNthCalledWith(1,'POST','/api/conversations',expect.objectContaining({name:'新任务'}));
 expect(m.api).toHaveBeenNthCalledWith(2,'POST','/api/conversations',expect.objectContaining({name:'写周报'}));
});
it('PA-SESSION-CREATE-01 phone draft without title is named after the phone and saved', async () => {
 S.agents.dev_1={...S.agents.dev_1,real:true} as never;
 const r=json(await call('session_create',{agent_id:'dev_1'}));
 expect(r).toMatchObject({status:'prepared',title:'小米手机 新任务',remote_created:false});
 expect(S.convs.find(c=>c.id===r.session_id)?.title).toBe('小米手机 新任务');
});
it('PA-SESSION-CREATE-01 wrong or oversized title is rejected and nothing is created', async () => {
 pa.providerId='provider'; pa.modelId='provider::model';
 for (const title of ['x'.repeat(161),'',' ',7,null,{}]) {
  const r=await call('session_create',{title}); expect(r.isError).toBe(true); expect(r.content[0].text).toContain('title');
 }
 expect(m.api).not.toHaveBeenCalled();
});
it('PA-SESSION-CREATE-01 schema and implementation agree: title optional, 1-160, both fields described', () => {
 const t=(sessions as unknown as {name:string;inputSchema:{properties:Record<string,{minLength?:number;maxLength?:number;description?:string}>;required:string[]}}[]).find(x=>x.name==='session_create')!;
 expect(Object.keys(t.inputSchema.properties).sort()).toEqual(['agent_id','title']);
 expect(t.inputSchema.required).toEqual([]);
 expect(t.inputSchema.properties.title).toMatchObject({minLength:1,maxLength:160});
 expect(t.inputSchema.properties.title.description).toBeTruthy();
});
it('PA-SESSION-02 unknown creation outcome never retries the write', async () => {
 pa.providerId='provider'; pa.modelId='provider::model'; m.api.mockRejectedValue(new Error('network'));
 const c={id:'unknown-create',scope:'pa-1',name:'session_create',arguments:JSON.stringify({title:'blank'})};
 expect((await executeSessionTool(c)).isError).toBe(true); await executeSessionTool(c);
 expect(m.api).toHaveBeenCalledTimes(1);
});

it('PA-CATALOG-01 AC6 discovery uses the running PA scope and does not send or invoke a backend', async () => {
  expect(json(await call('personal_capabilities', { id: 'session_create' }))).toMatchObject({ capability: { tool: 'session_create', effect: 'write' } });
  expect(json(await call('personal_targets', { kind: 'teams' }))).toMatchObject({ source: 'desktop-loaded-snapshot', targets: [] });
  expect(m.api).not.toHaveBeenCalled(); expect(m.send).not.toHaveBeenCalled(); expect(m.phone).not.toHaveBeenCalled();
  m.owned.mockReturnValue(false);
  expect((await call('personal_targets', { kind: 'teams' })).isError).toBe(true);
  m.owned.mockReturnValue(true); S.running.pa = false;
  expect((await call('personal_capabilities')).isError).toBe(true);
});

it('PA-TOOLS-02 A routes registered management calls through the live personal scope and deduplicates creation', async () => {
  localStorage.setItem('lom.personal.v1:owner', JSON.stringify({ items: [{ id: 'pa_a', name: 'PA', directory: '/a', workspace: '/a', conversation: pa.id, permission: 'full' }] }));
  const request = { id: 'pa-tools-create-registered', scope: pa.personalScope!, name: 'personal_team_create', arguments: JSON.stringify({ name: 'PA管理团队', members: [{ agent_id: 'lom', role: '主控', leader: true }] }) };
  expect(json(await executeSessionTool(request))).toMatchObject({ status: 'configured_in_memory', name: 'PA管理团队' });
  await executeSessionTool(request); expect(S.teams.filter(t => t.name === 'PA管理团队')).toHaveLength(1);
  delete S.running[pa.id]; expect((await executeSessionTool({ ...request, id: 'stopped-pa' })).isError).toBe(true);
});


it('PA-TEAM-01 routes to the leader by default and only the named member when requested', async () => {
  localStorage.setItem('lom.personal.v1:owner', JSON.stringify({ items: [{ id: 'pa_a', name: 'PA', directory: '/a', workspace: '/a', conversation: pa.id, permission: 'full' }] }));
  S.agentCatalog = [{ id: 'coding', name: '开发助手', backend: 'codex', enabled: true, installed: true, status: 'online', agent_type: 'acp', agent_source: 'external' }];
  const team = { id: 'team', ownerAccountId: 'owner', real: true, name: '工程', folder: '/a', created: 1, panes: {}, leaderConv: 'lead-chat', memberConvs: { worker: 'worker-chat' },
    members: [{ mid: 'lead', agent: 'pc', leader: true, role: '统筹' }, { mid: 'worker', agent: 'ag:coding', role: '开发' }] };
  S.teams = [team]; m.teamSend.mockResolvedValue(true);
  expect(json(await call('personal_team_read', { team_id: team.id })).members[1]).toMatchObject({ name: '开发助手', role: '开发', specialty: expect.any(String) });
  expect(json(await call('personal_team_send', { team_id: team.id, text: '组织调研' }))).toMatchObject({ session_id: 'lead-chat', member_id: 'lead' });
  expect(json(await call('personal_team_send', { team_id: team.id, member_id: 'worker', text: '修复构建' }))).toMatchObject({ session_id: 'worker-chat', member_id: 'worker' });
  expect(m.teamSend.mock.calls.map(([, member]) => member.mid)).toEqual(['lead', 'worker']);
  expect((await call('personal_team_send', { team_id: team.id, member_id: 'foreign', text: '测试' })).isError).toBe(true);
  expect(m.teamSend).toHaveBeenCalledTimes(2);
});

it('SSH-03 AC11 personal_ssh_exec is dispatched once per call id and audited without logging the command', async () => {
  const { saveSshServers } = await import('@/features/settings/runtime/sshServers');
  const { audit } = await import('@/features/settings/runtime/audit');
  localStorage.clear();
  saveSshServers('owner', [{ id: 'a1', name: '生产', destination: 'root@prod.test', port: 22 }]);
  const first = await call('personal_ssh_exec', { server: '生产', command: 'echo secret-in-command' });
  expect(first.isError).toBe(true);
  expect(first.content[0].text).toContain('请在 Lom 桌面应用中使用 SSH');
  expect(JSON.stringify((audit as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain('secret-in-command');
  expect((await call('personal_ssh_manage', { action: 'wipe' })).isError).toBe(true);
});
