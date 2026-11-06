import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Team } from '@/state/types';

const m = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn(), toastError: vi.fn() }));
vi.mock('@/core/client', async original => ({ ...await original<object>(), api: m.api, getEndpoint: () => ({ url: 'http://core', token: 't', defaultFolder: '/work', homeDir: '/Users/me' }) }));
vi.mock('@/shared/overlays/controller', async original => ({ ...await original<object>(), toast: m.toast, toastError: m.toastError, openModal: vi.fn(), openMenu: vi.fn() }));
const { MENUS } = await import('./menu-registry');

const codex = { id: 'ag_codex', name: 'Codex CLI', backend: 'codex', agent_type: 'acp', agent_source: 'builtin', enabled: true, installed: true, status: 'online' as const };
const model = (current: string) => ({ id: 'model', category: 'model', current_value: current, options: [{ value: 'old', name: 'Old' }, { value: 'new', name: 'New' }] });
const conv = (id: string) => ({ id, owner: 'pc', title: id, updated: 1, remote: true, loaded: true, messages: [], teamId: 't1', agentId: 'ag_codex', agentName: 'Codex CLI' });
let team: Team;

/** 点开某个团队窗格的模型菜单，选中「New」 */
const pickNew = (ckey: string) => {
  const item = MENUS.agentModel({ ckey }).find(i => typeof i === 'object' && 'label' in i && i.label === 'New');
  if (!item || typeof item === 'string' || !('onSelect' in item) || !item.onSelect) throw new Error('菜单里没有 New');
  item.onSelect();
};
const puts = () => m.api.mock.calls.filter(c => c[0] === 'PUT').map(c => c[1]);

beforeEach(() => {
  vi.clearAllMocks();
  S.cloud = 'signed-in'; S.agentCatalog = [codex]; S.agentModelPick = {}; S.convs = [conv('lc'), conv('mc')];
  S.agentOptions = { lc: [model('old')], mc: [model('old')] };
  team = { id: 't1', name: '小队', folder: '/work', created: 1, real: true, panes: {}, leaderConv: 'lc', memberConvs: { a: 'mc' },
    core: { id: 'core1', slots: {}, assistant: 'x' },
    members: [{ mid: 'l', agent: 'ag:ag_codex', role: '队长', leader: true }, { mid: 'a', agent: 'ag:ag_codex', role: '执行' }] };
  S.teams = [team];
  m.api.mockResolvedValue({ confirmation: 'observed', config_options: [model('new')] });
});

it('TEAM-MODEL-01 switching the leader pane model reaches the leader session through the core team', async () => {
  pickNew('team:t1:l');
  await vi.waitFor(() => expect(puts()).toEqual(['/api/teams/core1/conversations/lc/config-options/model']));
  expect(m.api).toHaveBeenCalledWith('PUT', '/api/teams/core1/conversations/lc/config-options/model', { value: 'new' });
});

it('TEAM-MODEL-01 switching a member pane model still reaches that member session', async () => {
  pickNew('team:t1:a');
  await vi.waitFor(() => expect(puts()).toEqual(['/api/teams/core1/conversations/mc/config-options/model']));
});

it('TEAM-MODEL-01 a started team never falls back to the new-task default or its "next tasks" notice', async () => {
  S.convs = [conv('mc')]; // 队长会话在本机找不到
  pickNew('team:t1:l');
  await vi.waitFor(() => expect(m.toastError).toHaveBeenCalled());
  expect(S.agentModelPick.ag_codex).toBeUndefined();
  expect(m.toast).not.toHaveBeenCalled();
  expect(puts()).toEqual([]);
  expect(m.toastError.mock.calls[0][1]).toMatchObject({ code: 'team.session_missing' });
});

it('TEAM-MODEL-01 before the team starts the pick is saved and the notice says it only affects later tasks', () => {
  Object.assign(team, { leaderConv: undefined, memberConvs: undefined, core: undefined });
  pickNew('team:t1:l');
  expect(S.agentModelPick.ag_codex).toBe('new');
  expect(m.toast.mock.calls[0][0]).toContain('之后的新任务');
  expect(puts()).toEqual([]);
});
