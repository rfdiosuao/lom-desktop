import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { api } from '@/core/client';
import { startDesktopTask } from './tasks';
vi.mock('@/core/client', () => ({ api: vi.fn(), getEndpoint: () => null }));
beforeEach(() => {
  vi.resetAllMocks();
  S.cloud = 'signed-out'; S.account = null; S.model = 'own::fixture'; S.agentPick = '';
  S.providers = [{ id: 'own', name: 'Own', platform: 'openai', base_url: '', models: ['fixture'], enabled: true, created_at: 1 }];
  vi.mocked(api).mockImplementation(async (method, path, body: any) => {
    if (path === '/api/skills') return [{ name: 'local-writer', source: 'custom' }];
    if (method === 'POST' && path === '/api/conversations') return { id: 'new-skill-task', type: 'aionrs', model: body.model, extra: body.extra };
    return { model: { provider_id: 'own', model: 'fixture' }, runtime: {}, turn_id: 'turn' };
  });
});
it('D09 ordinary new Lom tasks include the actual local personal skill in the creation request', async () => {
  expect(await startDesktopTask('use my installed skill', [], { agent: null })).toBe('new-skill-task');
  await vi.waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/api/conversations/new-skill-task/messages', expect.anything()));
  expect(api).toHaveBeenCalledWith('POST', '/api/conversations', expect.objectContaining({ extra: expect.objectContaining({ enabled_skills: ['local-writer'] }) }));
});
it('D09 local inventory failure preserves the draft and never creates a falsely usable chat', async () => {
  S.drafts.home = 'keep my draft';
  vi.mocked(api).mockRejectedValue(new Error('skill inventory unreachable'));
  expect(await startDesktopTask('use my installed skill', [], { agent: null })).toBeNull();
  expect(S.drafts.home).toBe('keep my draft');
  expect(vi.mocked(api).mock.calls.some(c => c[0] === 'POST' && c[1] === '/api/conversations')).toBe(false);
});
