import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import { initialState, loadPersisted } from '@/state/state';
import type { Conv } from '@/state/types';

/* /goal 像 Codex 那样：发出去后输入框上沿有「进行中的目标」，每轮结束自动接着推进，直到达成、暂停或停止。
 * 侧边聊天拖到主输入框：整理成 .md 附过去。「+」里收着工作文件夹 / 发送文件到手机 / 添加手机。 */
const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => ({ url: 'http://core', token: 't', defaultFolder: '/work', homeDir: '/Users/me' }) }));
vi.mock('@/shared/overlays/controller', () => ({ toast: vi.fn(), toastError: vi.fn(), openModal: vi.fn(), closeModal: vi.fn(), confirm: vi.fn(), prompt: vi.fn(), openMenu: vi.fn(), closeMenu: vi.fn(), topModal: () => undefined }));
const { setGoal, goalWantsNextTurn, goalElapsed, fmtElapsed, pauseGoal, resumeGoal, GOAL_MAX_TURNS } = await import('./commands');
const { GOAL_CONTINUE } = await import('./tasks');
const { handleCoreEvent } = await import('./stream');
const { stopTask } = await import('./cancel');
const { stripSettingsContext } = await import('@/features/settings/runtime/preferences');
const { sideChatMarkdown } = await import('./sideChat');
const { MENUS } = await import('@/app/overlays/menu-registry');

const task = (over: Partial<Conv> = {}): Conv => ({ id: 'g1', owner: 'pc', title: '作品集', updated: 1, messages: [], remote: true, loaded: true, agentId: 'ag_codex', ...over });
beforeEach(() => {
  m.api.mockReset(); m.api.mockResolvedValue({ turn_id: 'tn' });
  update(s => { s.convs = [task()]; s.running = {}; s.goals = {}; s.mode = 'desktop'; s.sideChat = null; s.teams = []; });
});
afterEach(() => { vi.useRealTimers(); });

it('goal: a finished turn automatically sends a hidden continue turn that never shows as a user message', async () => {
  vi.useFakeTimers();
  setGoal('conv:g1', '做完作品集网站');
  update(s => { s.running.g1 = true; });
  handleCoreEvent({ name: 'turn.completed', data: { conversation_id: 'g1', status: 'finished' } } as never);
  expect(S.goals['conv:g1'].turns).toBe(1);
  await vi.advanceTimersByTimeAsync(900);
  await vi.dynamicImportSettled?.();
  await vi.waitFor(() => expect(m.api).toHaveBeenCalledWith('POST', '/api/conversations/g1/messages', expect.objectContaining({ content: expect.stringContaining(GOAL_CONTINUE) })));
  const sent = m.api.mock.calls.find(c => c[1] === '/api/conversations/g1/messages')![2].content as string;
  expect(sent).toContain('做完作品集网站'); // 目标随隐藏块一起带过去
  expect(stripSettingsContext(sent)).toBe('');
  handleCoreEvent({ name: 'message.userCreated', data: { conversation_id: 'g1', content: sent } } as never);
  expect(S.convs[0].messages.filter(x => x.type === 'user')).toHaveLength(0);
});

it('goal: an errored turn, the turn cap, a manual stop and reopening Lom all pause instead of looping', async () => {
  setGoal('conv:g1', '网站');
  expect(goalWantsNextTurn('conv:g1', 'error')).toBe(false);
  expect(S.goals['conv:g1']).toMatchObject({ paused: true, note: expect.stringContaining('没有正常完成') });
  resumeGoal('conv:g1');
  update(s => { s.goals['conv:g1'].turns = GOAL_MAX_TURNS; });
  expect(goalWantsNextTurn('conv:g1', 'finished')).toBe(false);
  expect(S.goals['conv:g1'].paused).toBe(true);
  resumeGoal('conv:g1');
  expect(goalWantsNextTurn('conv:g1', 'finished')).toBe(true);
  m.api.mockResolvedValue({});
  update(s => { s.running.g1 = true; });
  await stopTask('g1');
  expect(S.goals['conv:g1']).toMatchObject({ paused: true, note: '已停止，目标暂停' });
  expect(goalWantsNextTurn('conv:g1', 'cancelled')).toBe(false);

  const st = initialState();
  localStorage.setItem('lom-desktop-v1', JSON.stringify({ goals: { 'conv:x': { text: '旧目标', at: 1 }, 'conv:y': { text: '已完成', at: 1, done: true } } }));
  loadPersisted(st);
  expect(st.goals['conv:x'].paused).toBe(true);
  expect(st.goals['conv:y'].paused).toBeFalsy();
});

it('goal: elapsed time skips paused time and reads like Codex (3s / 2m 5s / 1h 3m)', () => {
  const g = { at: 0, paused: true, pausedAt: 10_000, pausedMs: 0 };
  expect(goalElapsed(g, 99_000)).toBe(10_000);
  expect(goalElapsed({ at: 0, pausedMs: 4_000 }, 10_000)).toBe(6_000);
  expect([fmtElapsed(3_400), fmtElapsed(125_000), fmtElapsed(3_780_000)]).toEqual(['3s', '2m 5s', '1h 3m']);
  setGoal('conv:g1', '网站'); pauseGoal('conv:g1', '手动');
  expect(S.goals['conv:g1'].note).toBe('手动');
});

it('side chat: the conversation becomes a markdown attachment for the main task', () => {
  update(s => {
    s.convs.push(task({ id: 'side', title: '侧边聊天', sideOf: 'g1', agentId: undefined, messages: [
      { id: 'a', type: 'user', at: 1, text: '刚才为什么失败？' }, { id: 'b', type: 'assistant', at: 2, text: '端口被占用了。' }, { id: 'c', type: 'tool', at: 3, text: '' }] }));
    s.sideChat = { parent: 'g1', conv: 'side' };
  });
  const md = sideChatMarkdown()!;
  expect(md.name).toBe('侧边聊天-作品集.md');
  expect(md.text).toMatch(/^# 侧边聊天记录/);
  expect(md.text).toContain('### 我\n\n刚才为什么失败？');
  expect(md.text).toContain('### 助手\n\n端口被占用了。');
  update(s => { s.convs[1].messages = []; });
  expect(sideChatMarkdown()).toBeNull();
});

it('composer +: folder and phones live in the + menu; a phone task offers sending files to that phone', () => {
  update(s => { s.convs = [task({ agentId: undefined })]; });
  const labels = (ckey: string) => MENUS.attach({ ckey }).filter(x => x !== '-' && !x.header).map(x => (x as { label: string }).label);
  expect(labels('conv:g1')).toEqual(['文件', '添加图片', '工作文件夹', '添加手机', '海龟汤提问卡', '侧边对话']);
  update(s => { s.convs = [task({ id: 'p1', owner: 'p_phone', agentId: undefined })]; });
  expect(labels('conv:p1')).toEqual(['文件', '添加图片', '发送文件到手机', '手机', '海龟汤提问卡', '侧边对话']);
  update(s => { s.convs = [task()]; }); // 外部 Agent 不接手机
  expect(labels('conv:g1')).not.toContain('添加手机');
});

it('goal: picking 目标 from the slash menu with only the filter typed asks for the goal instead of using "/" as it', async () => {
  const { goalCmd } = await import('../actions/commands');
  const { prompt } = await import('@/shared/overlays/controller');
  const start = vi.fn();
  for (const draft of ['/', '/目', '/goal']) {
    update(s => { s.drafts['conv:g1'] = draft; });
    goalCmd('conv:g1', start);
  }
  expect(start).not.toHaveBeenCalled();
  expect(prompt).toHaveBeenCalledTimes(3);
  expect(S.goals['conv:g1']).toBeUndefined();
  update(s => { s.drafts['conv:g1'] = '/goal 做完作品集网站'; });
  goalCmd('conv:g1', start);
  expect(start).toHaveBeenCalledWith('做完作品集网站');
  expect(S.goals['conv:g1'].text).toBe('做完作品集网站');
});
