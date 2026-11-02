import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';

const m = vi.hoisted(() => ({ api: vi.fn(), invoke: vi.fn(), toast: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => ({ url: 'http://core', token: 't', defaultFolder: '/work' }) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
vi.mock('@/shared/overlays/controller', () => ({ toast: m.toast, toastError: m.toast, openModal: vi.fn() }));
const { startDesktopTask } = await import('@/features/chat/runtime/tasks');
const { viewImageTool } = await import('@/features/chat/runtime/vision');
const { taskRules, EXCLUDED_AUTO_SKILLS } = await import('./agentRules');

const codex = { id: 'ag_codex', name: 'Codex CLI', backend: 'codex', agent_type: 'acp', agent_source: 'builtin', enabled: true, installed: true, status: 'online' as const };

beforeEach(() => {
  vi.clearAllMocks();
  S.cloud = 'signed-in'; S.account = { id: 'acc', name: 'A', email: '' };
  S.agentCatalog = [codex]; S.agentPins = ['ag_codex']; S.agentPick = ''; S.convs = [];
  S.cloudModels = { pro: 'vision-pro', max: 'vision-max', mini: 'text-mini' }; S.cloudVision = ['pro', 'max'];
});

it('D07 a task started with an external agent is an ACP conversation without Lom model or phone tools', async () => {
  S.agentPick = 'ag_codex';
  m.api.mockImplementation(async (method: string, path: string, body?: Record<string, unknown>) => {
    if (method === 'POST' && path === '/api/conversations') return { id: 'c1', name: 't', type: 'acp', created_at: 1, modified_at: 1, extra: body?.extra };
    return { turn_id: 'turn' };
  });
  const id = await startDesktopTask('写个脚本', []);
  expect(id).toBe('c1');
  const create = m.api.mock.calls.find(c => c[1] === '/api/conversations')![2];
  expect(create).toMatchObject({ type: 'acp', extra: { backend: 'codex', agent_id: 'ag_codex', agent_name: 'Codex CLI', session_mode: 'default', exclude_auto_inject_skills: EXCLUDED_AUTO_SKILLS } });
  expect(create.model).toBeUndefined();
  expect(create.extra.selected_mcp_server_ids).toBeUndefined();
  expect(S.convs[0]).toMatchObject({ id: 'c1', agentId: 'ag_codex', agentName: 'Codex CLI' });
  await vi.waitFor(() => expect(m.api.mock.calls.some(c => c[1] === '/api/conversations/c1/messages')).toBe(true));
  // no model switch on the conversation for an external agent
  expect(m.api.mock.calls.some(c => c[0] === 'PATCH')).toBe(false);
});

it('D07 an unavailable external agent never starts a task', async () => {
  S.agentPick = 'ag_codex'; S.agentCatalog = [{ ...codex, status: 'missing', installed: false }];
  expect(await startDesktopTask('hi', [])).toBeNull();
  expect(m.api).not.toHaveBeenCalled();
});

it('identity rules name Lom only and point to the vision tool when signed in', () => {
  const r = taskRules(true, 'COMMANDER');
  expect(r).toContain('麓鸣 Lom');
  expect(r).toContain('lom_view_image');
  expect(r).toContain('COMMANDER');
  expect(r).not.toMatch(/aion/i);
  expect(taskRules(false)).not.toContain('lom_view_image');
  expect(EXCLUDED_AUTO_SKILLS).toContain('aionui-config');
});

it('vision tool uses the Lom vision tier and wipes the key it read', async () => {
  const providers = [{ id: 'p', name: 'Lom 云端', enabled: true, api_key: 'GW_KEY', base_url: 'https://gw/v1', models: [] }];
  m.api.mockResolvedValue(providers);
  m.invoke.mockResolvedValue('左边蓝色，右边黄色');
  const r = await viewImageTool({ file_path: '/tmp/a.png', question: '颜色？' });
  expect(m.invoke).toHaveBeenCalledWith('vision_describe', { path: '/tmp/a.png', question: '颜色？', baseUrl: 'https://gw/v1', apiKey: 'GW_KEY', model: 'vision-pro' });
  expect(r.content[0].text).toContain('左边蓝色');
  expect(providers[0].api_key).toBe('');
});

it('vision tool refuses without sign-in and reports failures as tool errors', async () => {
  S.cloud = 'signed-out';
  expect((await viewImageTool({ file_path: '/tmp/a.png' })).isError).toBe(true);
  S.cloud = 'signed-in';
  m.api.mockResolvedValue([{ id: 'p', name: 'Lom 云端', enabled: true, api_key: 'K', base_url: 'https://gw/v1', models: [] }]);
  m.invoke.mockRejectedValue(new Error('只支持 PNG、JPEG、GIF、WebP 图片'));
  const r = await viewImageTool({ file_path: '/tmp/a.txt' });
  expect(r.isError).toBe(true);
  expect(r.content[0].text).toContain('只支持');
});

it('audit: a homepage goal migrates to an external agent and reaches its first message', async () => {
  S.agentPick = 'ag_codex'; S.goals = { home: { text: '完成网站', at: 42 } };
  m.api.mockImplementation(async (method: string, path: string, body?: Record<string, unknown>) => {
    if (method === 'POST' && path === '/api/conversations') return { id: 'goal-task', name: 't', type: 'acp', created_at: 1, modified_at: 1, extra: body?.extra };
    return {};
  });
  await startDesktopTask('开始', []);
  await vi.waitFor(() => expect(m.api.mock.calls.some(c => c[1] === '/api/conversations/goal-task/messages')).toBe(true));
  expect(S.goals.home).toBeUndefined(); expect(S.goals['conv:goal-task'].text).toBe('完成网站');
  expect(m.api.mock.calls.find(c => c[1] === '/api/conversations/goal-task/messages')![2].content).toContain('完成网站');
});

it.each(['codex', 'claude'])('PHONE-IMAGE-01 %s receives a conversation-scoped phone bridge only for selected real phones', async backend => {
  const external = { ...codex, id: `ag_${backend}`, backend };
  S.agents.dev_image = { ...S.agents.p1, id: 'dev_image', real: true, status: 'online' };
  m.invoke.mockImplementation(async (_name, args) => ({ scope: args.scope, url: 'http://127.0.0.1:32100/mcp', token: 'test-only' }));
  m.api.mockImplementation(async (method: string, path: string, body?: any) => {
    if (path === '/api/mcp/servers' && method === 'GET') return [];
    if (path === '/api/mcp/servers' && method === 'POST') return { id: 'scoped-phone', enabled: false };
    if (path === '/api/conversations' && method === 'POST') return { id: `image-${backend}`, type: 'acp', extra: body.extra };
    return { turn_id: 'turn' };
  });
  const id = await startDesktopTask('把图片发到手机', [], { agent: external, phones: ['dev_image'] });
  expect(id).toBe(`image-${backend}`);
  const create = m.api.mock.calls.find(c => c[1] === '/api/conversations')![2];
  expect(create.extra.selected_mcp_server_ids).toEqual(['scoped-phone']);
  expect(create.extra.lom_phone_scope).toBeTruthy();
  expect(create.model).toBeUndefined();
  expect(S.convPhones[id!]).toEqual(['dev_image']);
  expect(S.convs[0].phoneScope).toBe(create.extra.lom_phone_scope);
  await vi.waitFor(() => expect(m.api.mock.calls.some(c => c[1] === `/api/conversations/${id}/messages`)).toBe(true));
});
