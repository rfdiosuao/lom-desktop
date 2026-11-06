import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';
const m = vi.hoisted(() => ({ api: vi.fn(), skills: vi.fn(), bridge: vi.fn(), cache: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api }));
vi.mock('@/features/skills/runtime/conversationSkills', () => ({ conversationSkills: m.skills }));
vi.mock('@/features/phones/runtime/phoneCommander', () => ({ commanderExtra: m.bridge, COMMANDER_RULES: 'ordinary commander rules' }));
vi.mock('@/features/phones/runtime/phoneCache', () => ({ savePhoneCache: m.cache }));
vi.mock('@/features/settings/runtime/agents', () => ({ agentRow: () => undefined, usable: () => false, acpExtra: () => ({}) }));
import { createSession } from './sessionCreate';
let self: Conv;
beforeEach(() => {
  vi.clearAllMocks(); S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' };
  self = { id: 'pa', owner: 'pc', title: 'Owner', messages: [], providerId: 'cloud', modelId: 'cloud::pro', lomTier: 'pro', workspace: '/owner-work', personalScope: 'pa-private', personal: { id: 'a', name: 'Owner', directory: '/owner-memory' } } as unknown as Conv;
  S.convs = [self]; S.convPhones = {}; S.agents = {}; S.permission = 'full'; S.folder = '/other-work';
  m.skills.mockResolvedValue({ enabled_skills: ['custom-skill'] });
  m.bridge.mockResolvedValue({ lom_phone_scope: 'fresh-phone', selected_mcp_server_ids: ['fresh-mcp'] });
  m.api.mockImplementation(async (_method, _path, body) => ({ id: 'new', name: body.name, type: body.type, extra: body.extra, model: body.model }));
  m.cache.mockResolvedValue(undefined);
});
it('PA-SESSION-02 blank Lom task receives normal rules/skills and a fresh bridge with default permission', async () => {
  expect(await createSession(self, { title: 'blank' }, () => true)).toMatchObject({ status: 'created', session_id: 'new' });
  const body = m.api.mock.calls[0][2];
  expect(body.model).toEqual({ provider_id: 'cloud', model: 'pro' });
  expect(body.extra).toMatchObject({ enabled_skills: ['custom-skill'], lom_phone_scope: 'fresh-phone', selected_mcp_server_ids: ['fresh-mcp'], session_mode: 'default', workspace: '/owner-work', lom_tier: 'pro' });
  expect(body.extra.preset_rules).toContain('ordinary commander rules');
  expect(body.extra.exclude_auto_inject_skills).toContain('conversation-create');
  expect(body.extra).not.toHaveProperty('lom_personal_scope');
  expect(S.convs[0].messages).toEqual([]); expect(S.folder).toBe('/other-work'); expect(S.permission).toBe('full');
});
it.each([undefined, {}, { id: '' }, { id: 7 }])('PA-SESSION-02 missing create receipt remains unknown without inserting a fake conversation: %j', async row => {
  m.api.mockResolvedValue(row);
  await expect(createSession(self, { title: 'blank' }, () => true)).rejects.toThrow('创建结果未确认');
  expect(S.convs).toEqual([self]);
});
it('PA-SESSION-02 parent revoked while preparing skills does not register a bridge or create a task', async () => {
  let current = true; m.skills.mockImplementation(async () => { current = false; return { enabled_skills: [] }; });
  await expect(createSession(self, { title: 'blank' }, () => current)).rejects.toThrow('变化');
  expect(m.bridge).not.toHaveBeenCalled(); expect(m.api).not.toHaveBeenCalled();
});
it('PA-SESSION-02 parent revoked during bridge preparation cannot create a task', async () => {
  let current = true; m.bridge.mockImplementation(async () => { current = false; return {}; });
  await expect(createSession(self, { title: 'blank' }, () => current)).rejects.toThrow('变化');
  expect(m.api).not.toHaveBeenCalled();
});
it('PA-SESSION-02 only a paired real device can produce a prepared phone draft', async () => {
  S.agents = { dev_demo: { real: false }, dev_live: { real: true, status: 'offline' } } as unknown as typeof S.agents;
  await expect(createSession(self, { title: 'blank', agent_id: 'dev_demo' }, () => true)).rejects.toThrow('找不到');
  expect(await createSession(self, { title: 'phone blank', agent_id: 'dev_live' }, () => true)).toMatchObject({ status: 'prepared', remote_created: false });
  expect(m.cache).toHaveBeenCalledTimes(1); expect(m.api).not.toHaveBeenCalled();
});

it('WS-REQUIRED-01 AC4 an assistant dispatch with no workspace fails with workspace.required and creates nothing', async () => {
  delete (self as { workspace?: string }).workspace; (self.personal as { directory: string }).directory = '';
  await expect(createSession(self, { title: 'blank' }, () => true)).rejects.toThrow('workspace.required');
  expect(m.api).not.toHaveBeenCalled();
  expect(S.convs).toEqual([self]);
});
