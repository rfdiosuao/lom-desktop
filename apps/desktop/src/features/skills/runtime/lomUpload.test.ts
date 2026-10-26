vi.mock('@/features/skills/runtime/conversationSkills', () => ({ conversationSkills: vi.fn(async () => ({ enabled_skills: ['fixture-personal'] })) }));
import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { api } from '@/core/client';
import { navigate } from '@/app/navigation';
import { prepareLomUpload, uploadSkills, uploadPrompt } from './lomUpload';
vi.mock('@/core/client', () => ({ api: vi.fn() }));
vi.mock('@/app/navigation', () => ({ navigate: vi.fn() }));
vi.mock('@/state/selectors', () => ({ perm: () => ({ coreMode: 'default' }), pcModels: () => [{ id: 'lom::pro', providerId: 'lom', model: 'pro', unavailable: false }] }));
vi.mock('@/features/chat/runtime/history', () => ({ convFromCore: (c: { id: string }) => ({ ...c, remote: true, owner: 'pc', modelId: 'lom::pro', messages: [] }) }));
const skill = { name: '写作', description: '写文章', source: 'custom' as const, location: '/work/skills/write' };
beforeEach(() => {
  vi.mocked(api).mockReset(); vi.mocked(navigate).mockClear();
  S.account = { id: 'a', name: 'A', email: 'a@test.invalid' }; S.drafts = { home: '原有草稿' }; S.attachments = { home: [{ name: '原附件', path: '/a.md' }] }; S.convs = [];
  vi.mocked(api).mockImplementation(async (_m, path) => path === '/api/conversations' ? { id: 'upload', type: 'aionrs' } : {});
});
it('D29 real local skills retain duplicate names distinguished by exact path', async () => {
  vi.mocked(api).mockResolvedValue({ skills: [skill, { ...skill, location: '/other/write' }, skill], warnings: ['skill.directory_unreadable'] });
  expect((await uploadSkills()).skills.map(x => x.location)).toEqual(['/other/write', '/work/skills/write']);
});
for (const choice of ['append', 'replace'] as const) it(`D29 ${choice} creates Lom draft with exact source and never sends or overwrites original`, async () => {
  await prepareLomUpload(skill, choice);
  expect(S.drafts.home).toBe('原有草稿'); expect(S.attachments.home[0].name).toBe('原附件');
  expect(S.drafts['conv:upload']).toBe(choice === 'append' ? `原有草稿\n\n${uploadPrompt('写作')}` : uploadPrompt('写作'));
  expect(S.attachments['conv:upload'].at(-1)?.path).toBe('/work/skills/write/SKILL.md');
  expect(api).toHaveBeenCalledWith('POST', '/api/conversations', expect.objectContaining({ type: 'aionrs', model: { provider_id: 'lom', model: 'pro' }, extra: expect.objectContaining({ enabled_skills: ['fixture-personal'] }) }));
  expect(vi.mocked(api).mock.calls.some(call => call[1].includes('/messages'))).toBe(false);
  expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'desktop', activeConv: 'upload' }));
});
it('D29 inaccessible skill fails before creation and preserves drafts', async () => {
  vi.mocked(api).mockRejectedValue(new Error('permission denied'));
  await expect(prepareLomUpload(skill, 'replace')).rejects.toThrow('permission denied');
  expect(S.drafts.home).toBe('原有草稿'); expect(navigate).not.toHaveBeenCalled(); expect(api).toHaveBeenCalledTimes(1);
});
it('D29 account switch during preflight cannot create upload', async () => {
  vi.mocked(api).mockImplementation(async () => { S.account = null; return {}; });
  await expect(prepareLomUpload(skill, 'append')).rejects.toThrow('账号已切换'); expect(api).toHaveBeenCalledTimes(1);
});
