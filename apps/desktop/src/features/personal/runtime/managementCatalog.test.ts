import { beforeEach, expect, it } from 'vitest';
import { discoverCapabilities, discoverTargets } from './managementCatalog';
import { S } from '@/state/store';
import type { AgentRow } from '@/features/settings/runtime/agents';

beforeEach(() => { S.account = { id: 'owner', name: '', email: '' }; S.agentCatalog = null; S.teams = []; S.agents = {}; });
it('PA-CATALOG-01 AC1 pages the registered tool catalog and exposes one real schema by stable ID or legacy name', () => {
  const first = discoverCapabilities({ limit: 2 });
  if (!first.capabilities) throw new Error('missing catalog');
  expect(first.capabilities.map(c => c.tool)).toEqual(['session_list', 'session_read']);
  expect(first.next_offset).toBe(2);
  expect(first.capabilities[0]).not.toHaveProperty('input_schema');
  const detail = discoverCapabilities({ id: first.capabilities[0].id });
  expect(detail).toEqual(discoverCapabilities({ id: 'session_list' }));
  expect(detail).toMatchObject({ capability: { version: 1, effect: 'read', availability: 'registered', verified_on_current_device: false, input_schema: { properties: { query: { type: 'string' } } } } });
  expect(discoverCapabilities({ offset: 2, limit: 2 })).toMatchObject({ capabilities: [{ tool: 'session_send', effect: 'write' }, { tool: 'session_wait', effect: 'read' }] });
});
it('PA-CATALOG-01 AC2 scope exposes PA diagnostics without granting phone control or pretending team creation exists', () => {
  const list = discoverCapabilities({ query: 'phone_', limit: 20 });
  if (!list.capabilities) throw new Error('missing catalog');
  expect(list.capabilities.some(c => c.tool === 'phone_list')).toBe(true);
  expect(() => discoverCapabilities({ id: 'phone_task_start' })).toThrow('没有注册');
  expect(() => discoverCapabilities({ id: 'team_create' })).toThrow('没有注册');
  expect(discoverCapabilities({ id: 'feishu_send_message' })).toMatchObject({ capability: { effect: 'write', adapter: 'feishu' } });
});
it('PA-CATALOG-01 AC3 real target discovery omits demos, credentials, raw diagnostics and execution claims', () => {
  S.agentCatalog = [{ id: 'a', name: 'Agent', agent_type: 'acp', agent_source: 'builtin', enabled: true, installed: true, status: 'unchecked', last_check_error_message: 'credential=private', env: { TOKEN: 'private' } } as AgentRow];
  expect(discoverTargets({ kind: 'agents' })).toMatchObject({ synchronized: false, targets: [{ id: 'a', observed_state: 'unchecked' }] });
  expect(JSON.stringify(discoverTargets({ kind: 'agents' }))).not.toContain('private');
  S.teams = [{ id: 'demo', real: false, members: [] }, { ownerAccountId: 'owner', id: 't', name: 'Team', real: true, members: [] }] as unknown as typeof S.teams;
  expect(discoverTargets({ kind: 'teams' })).toMatchObject({ total: 1, targets: [{ id: 't', phase: 'configured', management_tools_connected: true }] });
  S.agents = { demo: { id: 'demo', name: 'Demo', persona: '', status: 'offline', kind: 'phone' }, real: { id: 'real', name: 'Phone', persona: '', kind: 'phone', real: true, status: 'offline' } } as typeof S.agents;
  expect(discoverTargets({ kind: 'phones' })).toMatchObject({ total: 1, targets: [{ id: 'real', observed_state: 'offline' }] });
});
it('PA-CATALOG-01 AC4 empty unloaded snapshot is explicit and paging never includes extra targets', () => {
  expect(discoverTargets({ kind: 'agents' })).toMatchObject({ catalog_loaded: false, total: 0 });
  S.agentCatalog = Array.from({ length: 3 }, (_, i) => ({ id: String(i), name: 'Agent', installed: true, enabled: true, status: 'online' } as AgentRow));
  expect(discoverTargets({ kind: 'agents', limit: 1, offset: 1 })).toMatchObject({ total: 3, next_offset: 2, targets: [{ id: '1' }] });
});
it('PA-CATALOG-01 AC5 rejects malformed pagination, scope overrides and unknown target kinds', () => {
  for (const args of [{ limit: 0 }, { offset: -1 }, { offset: '0' }, { query: {} }, { account: 'other' }]) expect(() => discoverCapabilities(args)).toThrow();
  expect(() => discoverTargets({ kind: 'agents', limit: 51 })).toThrow();
  expect(() => discoverTargets({ kind: 'unknown' })).toThrow();
});

it('PA-TOOLS-02 A discovers the registered team and stop adapters with correct effects', () => {
  expect(discoverCapabilities({ id: 'personal_team_create' })).toMatchObject({ capability: { effect: 'write', adapter: 'team' } });
  expect(discoverCapabilities({ id: 'personal_team_read' })).toMatchObject({ capability: { effect: 'read', adapter: 'team' } });
  expect(discoverCapabilities({ id: 'session_stop' })).toMatchObject({ capability: { effect: 'write', adapter: 'session' } });
});

it('PA-TOOLS-03 searches all target types with exact matches first and keeps account boundaries', () => {
  S.agentCatalog = [{ id: 'desktop', name: '运营助手', installed: true, enabled: true, status: 'online' } as AgentRow];
  S.teams = [{ ownerAccountId: 'owner', id: 'team', name: '运营', real: true, members: [] },
    { ownerAccountId: 'other', id: 'hidden', name: '运营', real: true, members: [] }] as unknown as typeof S.teams;
  S.agents = { phone: { id: 'phone', name: '运营手机', persona: '', kind: 'phone', real: true, status: 'offline' } } as typeof S.agents;
  expect(discoverTargets({ query: '运营', limit: 1 })).toMatchObject({ total: 3, next_offset: 1,
    targets: [{ id: 'team', kind: 'teams', next_tool: 'personal_team_read', next_argument: 'team_id' }] });
  expect(discoverTargets({ query: 'PHONE' })).toMatchObject({ total: 1,
    targets: [{ id: 'phone', kind: 'phones', observed_state: 'offline', next_tool: 'session_create' }] });
});

it('TEAM-ORCH-03 the assistant is told in the tool contract what a duplicate send means', () => {
  const { capability } = discoverCapabilities({ id: 'personal_team_send' }) as { capability: { description: string } };
  expect(capability.description).toContain('duplicate');
  expect(capability.description).toContain('没有重复投递');
  expect(capability.description).toContain('session_read');
});

it('TEAM-ORCH-04 the catalog is honest that personal_agent_configure reads without a model and writes with one', () => {
  const { capability } = discoverCapabilities({ id: 'personal_agent_configure' }) as { capability: { effect: string; effect_detail: string; description: string } };
  expect(capability.effect).toBe('write'); // 保守：它能写
  expect(capability.effect_detail).toContain('只传 agent_id 时只读');
  expect(capability.description).toContain('只传 agent_id 为只读');
  expect(discoverCapabilities({ id: 'personal_team_read' })).not.toHaveProperty('capability.effect_detail');
});

it('TEAM-ORCH-06 the member model tool is a registered write capability the assistant can discover', () => {
  const { capability } = discoverCapabilities({ id: 'personal_team_member_model' }) as { capability: { effect: string; adapter: string; description: string } };
  expect(capability).toMatchObject({ effect: 'write', adapter: 'team' });
  expect(capability.description).toContain('personal_team_configure');
});
