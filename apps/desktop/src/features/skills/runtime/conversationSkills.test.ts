import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/core/client';
import { conversationSkills } from './conversationSkills';
vi.mock('@/core/client', () => ({ api: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
it('D09 new chats read each computer current personal skills without cached ownership or internal builtins', async () => {
  vi.mocked(api).mockResolvedValueOnce([
    { name: 'writer', source: 'custom' }, { name: 'aionui-config', source: 'custom' },
    { name: 'officecli', source: 'builtin' }, { name: 'writer', source: 'custom' },
  ]).mockResolvedValueOnce([{ name: 'local-only', source: 'custom' }]);
  expect(await conversationSkills()).toEqual({ enabled_skills: ['writer', 'aionui-config'] });
  expect(await conversationSkills()).toEqual({ enabled_skills: ['local-only'] });
});
it('D09 unavailable local skill inventory rejects instead of silently creating a chat without installed skills', async () => {
  vi.mocked(api).mockRejectedValue(new Error('core unreachable'));
  await expect(conversationSkills()).rejects.toThrow('core unreachable');
});
