import { beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { Team } from '@/state/types';

/* 审计交接 A03–A08 的修复（docs/ops/2026-10-16-audit-handoff.md） */
const m = vi.hoisted(() => ({ api: vi.fn(), invoke: vi.fn(), start: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => ({ url: 'http://core', token: 't', defaultFolder: '/work', homeDir: '/Users/me' }) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke, isTauri: () => false }));
vi.mock('@/features/chat/runtime/tasks', async original => ({ ...await original<object>(), startDesktopTask: m.start }));

beforeEach(() => { vi.clearAllMocks(); update(s => { s.modals = []; }); });

it('audit A03: the commander check is always created by Lom, never the external Agent picked in the switcher', async () => {
  const { superviseNow } = await import('@/features/chat/actions/composer');
  update(s => { s.cloud = 'signed-in'; s.agentPick = 'ag_codex'; s.agents.dev_r = { id: 'dev_r', kind: 'phone', name: 'REDMI', real: true, status: 'online' } as never; });
  m.start.mockResolvedValue(null);
  await superviseNow('dev_r');
  expect(m.start).toHaveBeenCalledWith(expect.any(String), [], expect.objectContaining({ phones: ['dev_r'], agent: null }));
});

it('audit A04: resetting demo data restores demo teams but keeps real teams, preferences and goals', async () => {
  const { restoreDemoTeams } = await import('../actions/settings');
  const real: Team = { id: 'mine', name: '我的团队', folder: '/w', created: 1, members: [], panes: {}, real: true };
  const out = restoreDemoTeams({ teams: [real, { id: 'old-demo', name: '改过的示例', members: [], panes: {} }], prefs: { confirmPublish: true }, goals: { 'conv:a': { text: '目标', at: 1 } } });
  expect((out.teams as Team[]).map(t => t.id)).toContain('mine');
  expect((out.teams as Team[]).map(t => t.id)).not.toContain('old-demo');
  expect((out.teams as Team[]).some(t => !t.real)).toBe(true);
  expect(out.prefs).toEqual({ confirmPublish: true });
  expect(out.goals).toEqual({ 'conv:a': { text: '目标', at: 1 } });
});

it('audit A05: two memories added at the same time both stay in the MEMORY.md index', async () => {
  const { addMemory } = await import('./lomMemory');
  const files: Record<string, string> = { '/mem/MEMORY.md': '# Memory Index\n' };
  m.invoke.mockResolvedValue('/mem');
  m.api.mockImplementation(async (_method: string, path: string, body: { path: string; data?: string }) => {
    await new Promise(r => setTimeout(r, 5)); // 读写之间留出交错的机会
    if (path === '/api/fs/read') return files[body.path];
    if (path === '/api/fs/write') { files[body.path] = body.data!; return {}; }
    return {};
  });
  await Promise.all([addMemory('/mem', '发布时间', '晚上 8 点', '/w'), addMemory('/mem', '语气', '口语化', '/w')]);
  expect(files['/mem/MEMORY.md']).toContain('[发布时间]');
  expect(files['/mem/MEMORY.md']).toContain('[语气]');
});

it('audit A06: a dialog with unsaved changes is not closed by Esc / × / 关闭 until the user confirms', async () => {
  const { openModal, closeModal, guardClose } = await import('@/shared/overlays/controller');
  openModal('lomMemory', {});
  let unsaved = true;
  guardClose('lomMemory', () => !unsaved);
  closeModal();
  closeModal(new MouseEvent('click')); // 按钮的 onClick 会把事件传进来，不能当成强制关闭
  expect(S.modals.map(x => x.id)).toEqual(['lomMemory']);
  closeModal(true);
  expect(S.modals).toHaveLength(0);
  openModal('lomMemory', {}); unsaved = false; closeModal();
  expect(S.modals).toHaveLength(0);
  guardClose('lomMemory', null);
});

it('audit A08: a half-written goal marker never flashes while streaming; normal brackets stay', async () => {
  const { visibleReply } = await import('@/features/chat/runtime/commands');
  for (const tail of ['[L', '[LOM_GOAL_D', '[LOM_GOAL_DONE:', '[LOM_GOAL_DONE:17', '[LOM_GOAL_DONE:17]']) {
    expect(visibleReply(`已经部署好了。\n${tail}`, true)).toBe('已经部署好了。');
  }
  expect(visibleReply('参考 [链接](https://x)', true)).toBe('参考 [链接](https://x)');
  expect(visibleReply('已经部署好了。\n[LOM_GOAL_D', false)).toBe('已经部署好了。\n[LOM_GOAL_D');
});

it('audit B01: a background send keeps its own model even while another task with another model is in front', async () => {
  const { sendToTask } = await import('@/features/chat/runtime/tasks');
  update(s => {
    s.providers = [{ id: 'p1', platform: 'openai', name: 'A', base_url: '', models: ['m-a'], enabled: true, created_at: 1 }, { id: 'p2', platform: 'openai', name: 'B', base_url: '', models: ['m-b'], enabled: true, created_at: 1 }];
    s.convs = [{ id: 'a', owner: 'pc', title: 'A', updated: 1, messages: [], remote: true, agentId: undefined, modelId: 'p1::m-a', providerId: 'p1' },
      { id: 'b', owner: 'pc', title: 'B', updated: 1, messages: [], remote: true, modelId: 'p2::m-b', providerId: 'p2' }];
    s.route = { name: 'chat' }; s.activeConv = 'b'; s.model = 'p2::m-b'; s.cloud = 'signed-out'; s.running = {}; s.teams = [];
  });
  m.api.mockImplementation(async (method: string, path: string) => {
    if (method === 'GET' && path === '/api/conversations/a') return { id: 'a', model: { provider_id: 'p1', model: 'm-a' } };
    return { turn_id: 't' };
  });
  expect(await sendToTask(S.convs[0], '继续推进', [])).toBe(true);
  expect(m.api.mock.calls.some(c => c[0] === 'PATCH' && c[1] === '/api/conversations/a')).toBe(false);
  expect(m.api).toHaveBeenCalledWith('POST', '/api/conversations/a/messages', expect.objectContaining({ content: expect.stringContaining('继续推进') }));
});

it('audit B01: picking a model in a kernel team pane switches that member and restarts the team session', async () => {
  const { pickModel } = await import('@/features/chat/actions/composer');
  update(s => {
    s.providers = [{ id: 'p1', platform: 'openai', name: 'A', base_url: '', models: ['m-a', 'm-c'], enabled: true, created_at: 1 }];
    s.convs = [{ id: 'lead', owner: 'pc', title: 'Lom', updated: 1, messages: [], remote: true, modelId: 'p1::m-a', providerId: 'p1', teamId: 't9' }];
    s.teams = [{ id: 't9', name: '队', folder: '/w', created: 1, real: true, panes: {}, members: [{ mid: 'l', agent: 'pc', role: '总编', leader: true }], leaderConv: 'lead', core: { id: 'core9', slots: { l: 's1' }, assistant: 'a1' } }];
    s.running = {}; s.model = 'p1::m-a';
  });
  m.api.mockImplementation(async (method: string, path: string, body?: { model?: { model: string } }) => {
    if (path === '/api/conversations/lead') return { id: 'lead', model: { provider_id: 'p1', model: method === 'PATCH' ? body!.model!.model : 'm-a' } };
    return {};
  });
  await pickModel({ model: 'p1::m-c', agent: 'pc', ckey: 'team:t9:l' });
  expect(m.api).toHaveBeenCalledWith('PATCH', '/api/conversations/lead', { model: { provider_id: 'p1', model: 'm-c' } });
  expect(m.api).toHaveBeenCalledWith('DELETE', '/api/teams/core9/session');
  expect(S.convs[0].modelId).toBe('p1::m-c');
  expect(S.model).toBe('p1::m-a'); // 全局选择不变
});
