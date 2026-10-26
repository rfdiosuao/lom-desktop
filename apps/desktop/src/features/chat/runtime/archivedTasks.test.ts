import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => ({ url: 'http://core', token: 't', defaultFolder: '/work', homeDir: '/home/me' }) }));
const { listTasks } = await import('./history');

const conv = (id: string) => ({ id, type: 'aionrs', name: id, created_at: 1, modified_at: 1, extra: {} });
let archivedFails = false;

beforeEach(() => {
  archivedFails = false;
  m.api.mockReset();
  m.api.mockImplementation(async (_method: string, path: string) => {
    if (path.startsWith('/api/conversations?')) return { items: ['keep', 'gone', 'gone-later', 'team-member'].map(conv), has_more: false };
    if (path.startsWith('/api/sidebar?archived=1')) {
      if (archivedFails) throw new Error('sidebar unavailable');
      return { has_more_groups: false, groups: [
        { scope: { type: 'chats' }, items: [{ type: 'conversation', conversation: conv('gone') }], has_more: true, next_cursor: 'c1' },
        { scope: { type: 'pinned' }, items: [{ type: 'team', team_id: 'T', member_conversation_ids: ['team-member'] }], has_more: false },
      ] };
    }
    if (path.startsWith('/api/sidebar/items?')) {
      expect(path).toContain('archived=1');
      expect(path).toContain('scope=chats');
      expect(path).toContain('cursor=c1');
      return { items: [{ type: 'conversation', conversation: conv('gone-later') }], has_more: false };
    }
    throw new Error(`unexpected ${path}`);
  });
});

it('ARCHIVE-01 archived tasks never come back into the task list, including ones on later archive pages', async () => {
  expect((await listTasks()).map(c => c.id)).toEqual(['keep']);
});

it('ARCHIVE-01 if the archive state cannot be read, the task list still loads instead of failing', async () => {
  archivedFails = true;
  expect((await listTasks()).map(c => c.id)).toEqual(['keep', 'gone', 'gone-later', 'team-member']);
});
