import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { beginAuthChange } from '@/features/account/runtime/authScope';
const m = vi.hoisted(() => ({ invoke: vi.fn(), api: vi.fn(), read: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => m.invoke(...a), isTauri: () => true }));
vi.mock('@/core/client', () => ({ api: (...a: unknown[]) => m.api(...a) }));
vi.mock('./memory', () => ({ DOCUMENTS: [['USER.md', '关于你', '偏好']], readDocument: (...a: unknown[]) => m.read(...a) }));
const { evolvePersonalTurn } = await import('./evolution');
let c: any, rows: any[];
beforeEach(() => {
  localStorage.clear(); beginAuthChange(); m.invoke.mockReset(); m.api.mockReset(); m.read.mockReset(); m.read.mockResolvedValue('学习后的表达偏好');
  S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' };
  c = { id: 'c', owner: 'pc', title: '小麓', updated: 0, remote: true, modelId: 'p::m', providerId: 'p', personal: { id: 'pa_a', directory: '/a', name: '小麓' }, messages: [
    { id: 'u', remoteId: 'user-1', type: 'user', at: 1, text: '以后回答简短一点' }, { id: 'r', type: 'assistant', at: 2, text: '好的' },
  ] }; S.convs = [c];
  localStorage.setItem('lom.personal.v1:owner', JSON.stringify({ items: [{ id: 'pa_a', name: '小麓', directory: '/a', workspace: '/a', conversation: 'c' }] }));
  rows = [{ id: 'p', name: 'Lom 云端', enabled: true, api_key: 'test-only', base_url: 'https://example.invalid/v1', models: ['m'] }];
  m.api.mockResolvedValue(rows);
  m.invoke.mockImplementation((name: string) => Promise.resolve(name === 'personal_reflect' ? '[]' : { adopted: 0, version: 0 }));
});
it('PA-EVOLVE-02 extracts and applies once without sending a chat message', async () => {
  await evolvePersonalTurn(c, 'turn-a'); await evolvePersonalTurn(c, 'turn-a');
  expect(m.invoke.mock.calls.map(x => x[0])).toEqual(['personal_reflect', 'personal_apply_learning']);
  expect(m.invoke.mock.calls[0][1]).toMatchObject({ model: 'm', user: '以后回答简短一点', reply: '好的' });
  expect(m.api).toHaveBeenCalledTimes(1);
});
it('PA-EVOLVE-02 ordinary agents do not trigger charges', async () => {
  c.personal = undefined; await evolvePersonalTurn(c, 'ordinary'); expect(m.api).not.toHaveBeenCalled();
});
it('PA-EVOLVE-02 auth change during extraction prevents writes', async () => {
  m.invoke.mockImplementation(async () => { beginAuthChange(); return '[]'; });
  await evolvePersonalTurn(c, 'auth'); expect(m.invoke).toHaveBeenCalledTimes(1);
});
it('PA-EVOLVE-02 failures remain visible', async () => {
  m.invoke.mockRejectedValue(new Error('offline')); await evolvePersonalTurn(c, 'fail');
  expect(c.messages.at(-1)).toMatchObject({ type: 'system', text: expect.stringContaining('学习未完成') });
});
it('PA-EVOLVE-02 erases fetched credentials', async () => {
  await evolvePersonalTurn(c, 'clean'); expect(rows[0].api_key).toBe('');
});

it('PA-EVOLVE-02 next-turn memory waits for native publication', async () => {
  let release!: () => void;
  m.invoke.mockImplementation((name: string) => name === 'personal_reflect' ? new Promise<string>(r => { release = () => r('[]'); }) : Promise.resolve({ adopted: 0, version: 0 }));
  const running = evolvePersonalTurn(c, 'wait');
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const { waitPersonalLearning } = await import('./evolution');
  let finished = false; const waiting = waitPersonalLearning(c).then(() => { finished = true; });
  await Promise.resolve(); expect(finished).toBe(false); release(); await running; await waiting; expect(finished).toBe(true);
});

it('PA-EVOLVE-02 memory delivery contains the published preference after a completed turn', async () => {
  let release!: () => void;
  m.invoke.mockImplementation((name: string) => name === 'personal_reflect' ? new Promise<string>(r => { release = () => r('[]'); }) : Promise.resolve({ adopted: 1, version: 1, correction: true }));
  const running = evolvePersonalTurn(c, 'context');
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const { preparePersonalMemory } = await import('./context');
  const prepared = preparePersonalMemory(c);
  await Promise.resolve(); expect(m.read).not.toHaveBeenCalled();
  release(); await running;
  expect((await prepared)?.text).toContain('学习后的表达偏好');
});
it('PA-EVOLVE-02 foreign catalog ownership blocks extraction charges', async () => {
  localStorage.clear(); await evolvePersonalTurn(c, 'foreign'); expect(m.api).not.toHaveBeenCalled();
});
it('PA-EVOLVE-02 scheduled task prompts are not learned from and cost nothing', async () => {
  c.messages[0].source = 'schedule';
  await evolvePersonalTurn(c, 'scheduled');
  expect(m.api).not.toHaveBeenCalled(); expect(m.invoke).not.toHaveBeenCalled();
});
it('PA-EVOLVE-02 having nothing reliable to learn stays out of the conversation', async () => {
  m.invoke.mockRejectedValue(new Error('personal.learning_evidence'));
  await evolvePersonalTurn(c, 'nothing');
  expect(c.messages.filter((x: { type: string }) => x.type === 'system')).toEqual([]);
});
