import { beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { Conv, Team } from '@/state/types';

/* 斜杠命令：压缩、归档、推理强度、目标、记忆路径、团队窗格里的技能和提问卡 */
const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => ({ url: 'http://core', token: 't', defaultFolder: '/work', homeDir: '/Users/me' }) }));
vi.mock('@/shared/overlays/controller', () => ({ toast: vi.fn(), toastError: vi.fn(), openModal: vi.fn(), closeModal: vi.fn(), confirm: vi.fn(), prompt: vi.fn(), openMenu: vi.fn(), topModal: () => undefined }));
const { compactTask, compactNotice, archiveTask, listArchived, setTaskEffort, effortResult, goalContext, setGoal, checkGoalReached, lomSupportsEffort } = await import('./commands');
const { memoryDir } = await import('@/features/settings/runtime/lomMemory');
const { slashMenu } = await import('../slash/slashMenu');
const { stripSettingsContext, publicationPolicy } = await import('@/features/settings/runtime/preferences');

const lomTask = (): Conv => ({ id: 'lt', owner: 'pc', title: '做网站', updated: 1, messages: [], remote: true, loaded: true, providerId: 'own', workspace: '/Users/me/Documents/Lom' });

type FakeCore = { runtime: { has_task?: boolean; is_processing?: boolean }; extra: { reasoning_effort?: string } };
/** 有状态的假核心：GET 返回真实保存值，PATCH 改写它；断言可以同时检查核心与 UI */
function installCore(initial: FakeCore, opts: { failGet?: 'first' | 'after-patch' | 'always'; busyAfterPatch?: boolean; failRuntime?: boolean; failRollback?: boolean } = {}) {
  const state: FakeCore = { runtime: { ...initial.runtime }, extra: { ...initial.extra } };
  const calls: { method: string; path: string; body?: unknown }[] = [];
  let patches = 0, gets = 0;
  m.api.mockImplementation(async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    if (path === '/api/conversations/lt') {
      if (method === 'GET') {
        gets++;
        const fail = opts.failGet === 'always' || (opts.failGet === 'first' && gets === 1) || (opts.failGet === 'after-patch' && patches > 0);
        if (fail) throw new Error('core offline');
        if (opts.busyAfterPatch && patches > 0) state.runtime.is_processing = true;
        return structuredClone(state);
      }
      if (method === 'PATCH') {
        if (opts.failRollback && patches > 0) throw new Error('rollback failed');
        patches++;
        const next = (body as { extra: { reasoning_effort: string | null } }).extra.reasoning_effort;
        state.extra.reasoning_effort = next || undefined;
        return {};
      }
    }
    if (method === 'POST') {
      if (opts.failRuntime) throw new Error('runtime failed');
      return { turn_id: 't1' };
    }
    return {};
  });
  return { state, calls };
}

beforeEach(() => {
  m.api.mockReset();
  update(s => {
    s.convs = [lomTask()]; s.running = {}; s.goals = {}; s.mode = 'desktop'; s.agentPick = '';
    s.providers = [{ id: 'own', platform: 'openai', name: 'mock', base_url: '', models: ['m'], enabled: true, created_at: 1 }, { id: 'ant', platform: 'anthropic', name: 'a', base_url: '', models: ['c'], enabled: true, created_at: 1 }];
  });
});

it('compact sends exactly /compact (no settings prefix) and reads the engine reply as one line', async () => {
  m.api.mockResolvedValue({ turn_id: 't1' });
  await compactTask(S.convs[0]);
  expect(m.api).toHaveBeenCalledWith('POST', '/api/conversations/lt/messages', { content: '/compact', files: [] });
  expect(S.convs[0].messages.at(-1)?.text).toBe('正在压缩上下文…');
  expect(compactNotice('Context compacted: 0k → compact (4 messages summarized)')).toContain('4 条消息');
  expect(compactNotice('Context is already compact')).toContain('不需要压缩');
  expect(compactNotice('普通回复')).toBeNull();
});

it('compact refuses while the task is running and for agents without a compact command', async () => {
  update(s => { s.running.lt = true; });
  await expect(compactTask(S.convs[0])).rejects.toThrow('还在执行');
  update(s => { s.running = {}; s.convs[0].agentId = 'ag_x'; s.convs[0].agentName = 'Kimi'; });
  m.api.mockResolvedValueOnce([{ command: 'help', description: '' }]);
  await expect(compactTask(S.convs[0])).rejects.toThrow('Kimi 没有提供压缩');
});

it('archive calls the core archive API and drops the task from the list; archived list reads conversations', async () => {
  m.api.mockResolvedValue({});
  await archiveTask(S.convs[0]);
  expect(m.api).toHaveBeenCalledWith('POST', '/api/sidebar/conversation/lt/archive');
  expect(S.convs).toHaveLength(0);
  m.api.mockResolvedValueOnce({ groups: [{ items: [{ type: 'conversation', conversation: { id: 'old', name: '旧任务', type: 'aionrs', created_at: 1, modified_at: 2 } }, { type: 'team' }] }] });
  expect((await listArchived()).map(c => c.title)).toEqual(['旧任务']);
});

it('reasoning effort for a Lom task: read core first, PATCH extra, confirm, then restart; UI mirrors core', async () => {
  // 运行时已在跑（has_task 真）→ 重启让新强度对下一轮生效
  const core = installCore({ runtime: { has_task: true }, extra: { reasoning_effort: 'low' } });
  S.convs[0].effort = 'low';
  expect(await setTaskEffort(S.convs[0], 'high')).toBe('next_turn');
  expect(core.calls.map(c => `${c.method} ${c.path}`)).toEqual([
    'GET /api/conversations/lt',
    'PATCH /api/conversations/lt',
    'GET /api/conversations/lt',
    'POST /api/conversations/lt/runtime/restart',
  ]);
  expect(core.state.extra.reasoning_effort).toBe('high');
  expect(S.convs[0].effort).toBe(core.state.extra.reasoning_effort);
  expect(lomSupportsEffort('own')).toBe(true); expect(lomSupportsEffort('ant')).toBe(false);
});

it('audit: a never-started runtime uses ensure, not restart', async () => {
  const core = installCore({ runtime: {}, extra: {} });
  expect(await setTaskEffort(S.convs[0], 'low')).toBe('next_turn');
  expect(core.calls.some(c => c.path === '/api/conversations/lt/runtime/ensure')).toBe(true);
  expect(core.calls.some(c => c.path === '/api/conversations/lt/runtime/restart')).toBe(false);
  expect(core.state.extra.reasoning_effort).toBe('low');
  expect(S.convs[0].effort).toBe(core.state.extra.reasoning_effort);
});

it('audit: runtime failure rolls the core value back and only then shows the old value', async () => {
  const core = installCore({ runtime: { has_task: true }, extra: { reasoning_effort: 'low' } }, { failRuntime: true });
  S.convs[0].effort = 'low';
  await expect(setTaskEffort(S.convs[0], 'high')).rejects.toThrow('核心已恢复原推理强度');
  expect(core.state.extra.reasoning_effort).toBe('low');
  expect(S.convs[0].effort).toBe(core.state.extra.reasoning_effort);
});

it('audit: an unconfirmed rollback reports partial completion and shows what the core actually kept', async () => {
  const core = installCore({ runtime: { has_task: true }, extra: { reasoning_effort: 'low' } }, { failRuntime: true, failRollback: true });
  S.convs[0].effort = 'low';
  await expect(setTaskEffort(S.convs[0], 'high')).rejects.toThrow('回滚未确认');
  expect(core.state.extra.reasoning_effort).toBe('high');
  expect(S.convs[0].effort).toBe(core.state.extra.reasoning_effort);
});

it('audit: a failed core-state read aborts before any write and is never treated as idle', async () => {
  const core = installCore({ runtime: {}, extra: { reasoning_effort: 'low' } }, { failGet: 'always' });
  S.convs[0].effort = 'low';
  await expect(setTaskEffort(S.convs[0], 'high')).rejects.toThrow('读取任务运行状态失败');
  expect(core.calls.some(c => c.method === 'PATCH')).toBe(false);
  expect(core.calls.some(c => c.method === 'POST')).toBe(false);
  expect(core.state.extra.reasoning_effort).toBe('low');
  expect(S.convs[0].effort).toBe('low');
});

it('audit: a post-write read failure is reported as unconfirmed, never as unchanged', async () => {
  const core = installCore({ runtime: { has_task: true }, extra: { reasoning_effort: 'low' } }, { failGet: 'after-patch' });
  S.convs[0].effort = 'low';
  await expect(setTaskEffort(S.convs[0], 'high')).rejects.toThrow('未确认');
  expect(core.state.extra.reasoning_effort).toBe('high');
  expect(S.convs[0].effort).toBe('high');
  expect(core.calls.some(c => c.method === 'POST')).toBe(false);
});

it('audit: a task that starts between the check and the write keeps the saved value, without restarting', async () => {
  const core = installCore({ runtime: { has_task: true }, extra: { reasoning_effort: 'low' } }, { busyAfterPatch: true });
  S.convs[0].effort = 'low';
  expect(await setTaskEffort(S.convs[0], 'high')).toBe('next_turn');
  expect(core.calls.some(c => c.path.includes('/runtime/'))).toBe(false);
  expect(core.state.extra.reasoning_effort).toBe('high');
  expect(S.convs[0].effort).toBe(core.state.extra.reasoning_effort);
});

it('goal rides along hidden, never shows as the user text, and completes when the reply says so', () => {
  setGoal('conv:lt', '做完作品集网站');
  const block = goalContext('conv:lt');
  expect(block).toContain('做完作品集网站');
  expect(stripSettingsContext(`${publicationPolicy()}\n\n${block}帮我改一下首页`)).toBe('帮我改一下首页');
  checkGoalReached('conv:lt', `已经部署好了。\n[LOM_GOAL_DONE:${S.goals['conv:lt'].at}]`);
  expect(S.goals['conv:lt'].done).toBe(true);
  expect(goalContext('conv:lt')).toBe('');
});

it('memory folder follows the engine rule (each non-ASCII-alphanumeric char becomes -)', () => {
  expect(memoryDir('/Users/me/Documents/Lom')).toBe('/Users/me/Library/Application Support/aionrs/projects/-Users-me-Documents-Lom/memory');
  expect(memoryDir('/Users/me/文档')).toBe('/Users/me/Library/Application Support/aionrs/projects/-Users-me---/memory');
});

it('slash commands are live for a real task, and skills / question card work inside an OPC team pane', () => {
  const row = (key: string, label: string) => slashMenu(key, '').find(x => x !== '-' && !x.header && x.label === label) as { disabled?: boolean } | undefined;
  for (const label of ['侧边聊天', '压缩', '归档', '推理', '记忆', '目标']) expect(row('conv:lt', label)?.disabled).toBeFalsy();
  const t: Team = { id: 't1', name: '队', folder: '/work', created: 1, real: true, panes: {}, members: [{ mid: 'l', agent: 'pc', role: '总编', leader: true }] };
  update(s => { s.teams = [t]; s.commandSkills = { items: [{ name: 'officecli', description: 'Office', source: 'builtin' }], loading: false, error: '' } as never; });
  expect(row('team:t1:l', '海龟汤提问卡')?.disabled).toBeFalsy();
  expect(row('team:t1:l', 'officecli')?.disabled).toBeFalsy();
});

it('audit: negated or quoted completion text must not finish a goal', () => {
  for (const text of ['尚未完成，请不要写“目标已达成”。', '目标已达成了吗？', '目标已达成。但还有部署没有完成。']) {
    setGoal('conv:lt', '网站'); checkGoalReached('conv:lt', text);
    expect(S.goals['conv:lt'].done).not.toBe(true);
  }
});

it('review: completion markers are hidden for display and copying without mutating raw reply', async () => {
  const { visibleReply } = await import('./commands');
  const raw = '完成了。\n[LOM_GOAL_DONE:42]';
  expect(visibleReply(raw)).toBe('完成了。');
  expect(visibleReply('解释：[LOM_GOAL_DONE:42] 是标记')).toContain('是标记');
  expect(visibleReply('完成了。\r\n[LOM_GOAL_DONE:42]\r\n')).toBe('完成了。');
});

/* ---------- EFFORT-01：每个 Agent 用它自己的档位（#144） ---------- */

const extConv = (agentId: string, name: string): Conv => ({ ...lomTask(), id: `ct_${agentId}`, agentId, agentName: name, agentBackend: agentId === 'ag_codex' ? 'codex' : 'qoder' });

const withExtOptions = (values: string[] = ['fast', 'balanced', 'deep']) => update(s => {
  const prev = s.agentOptions[s.convs[0].id] || [];
  const others = prev.filter(o => o.id !== 'thought_level');
  s.agentOptions[s.convs[0].id] = [...others, { id: 'thought_level', category: 'thought_level', current_value: 'fast', options: values.map(v => ({ value: v })) }];
});

it('EFFORT-01: an external Agent sends its own reported option id, not low/medium/high', async () => {
  update(s => { s.convs = [extConv('ag_q', 'Qoder')]; });
  withExtOptions();
  m.api.mockResolvedValueOnce({ confirmation: 'observed', config_options: [{ id: 'thought_level', category: 'thought_level', current_value: 'deep', options: [{ value: 'fast' }, { value: 'balanced' }, { value: 'deep' }] }] });
  expect(await setTaskEffort(S.convs[0], 'deep')).toBe('observed');
  expect(m.api).toHaveBeenCalledWith('PUT', '/api/conversations/ct_ag_q/config-options/thought_level', { value: 'deep' });
});

it('EFFORT-01: an option id without any option list is never claimed as unsupported', async () => {
  update(s => { s.convs = [extConv('ag_q', 'Qoder')]; });
  withExtOptions();
  // 一个只有 id、还没读到选项的 CLI：不能断言「不支持」
  update(s => { s.agentOptions[S.convs[0].id] = [{ id: 'thought_level', options: [] }]; });
  await expect(setTaskEffort(S.convs[0], 'deep')).rejects.toThrow('没有推理强度选项');
});

it('EFFORT-01: effort variants match across normalization (thoughtLevel / model_reasoning_effort / thinking)', async () => {
  const { effortOption } = await import('@/features/settings/runtime/agentOptions');
  const mk = (id: string, category?: string) => [{ id, category, options: [{ value: 'x' }] }];
  expect(effortOption(mk('thought_level'))?.id).toBe('thought_level');
  expect(effortOption(mk('thoughtLevel'))?.id).toBe('thoughtLevel');
  expect(effortOption(mk('model_reasoning_effort'))?.id).toBe('model_reasoning_effort');
  expect(effortOption(mk('effort'))?.id).toBe('effort');
  expect(effortOption(mk('thinking', 'thinking'))?.id).toBe('thinking');
  // 不相关的选项不能误判成推理强度
  expect(effortOption(mk('model', 'model'))).toBeUndefined();
  expect(effortOption(mk('verbose_thoughts'))).toBeUndefined();
});

it('EFFORT-01: concurrent changes to one task are rejected, not silently overwritten', async () => {
  let release = () => {};
  const gate = new Promise<void>(r => { release = r; });
  m.api.mockImplementation(async (method, path) => {
    if (path === '/api/conversations/lt') return { runtime: { has_task: true } };
    if (method === 'POST') { await gate; return {}; }
    return {};
  });
  const first = setTaskEffort(S.convs[0], 'high');
  await expect(setTaskEffort(S.convs[0], 'low')).rejects.toThrow('正在调整');
  release();
  expect(await first).toBe('next_turn');
});

it('EFFORT-01: a task running in core is refused before PATCH; core and UI keep the old tier', async () => {
  const core = installCore({ runtime: { has_task: true, is_processing: true }, extra: { reasoning_effort: 'low' } });
  S.convs[0].effort = 'low';
  await expect(setTaskEffort(S.convs[0], 'high')).rejects.toThrow('正在执行');
  expect(core.calls.some(c => c.method === 'PATCH')).toBe(false);
  expect(core.calls.some(c => c.method === 'POST')).toBe(false);
  expect(core.state.extra.reasoning_effort).toBe('low');
  expect(S.convs[0].effort).toBe(core.state.extra.reasoning_effort);
});

it('EFFORT-01: selecting the current tier for an external Agent still reports through the core confirmation', async () => {
  update(s => { s.convs = [extConv('ag_c', 'Codex CLI')]; });
  withExtOptions(['low', 'high']);
  m.api.mockResolvedValueOnce({ confirmation: 'pending_next_turn' });
  expect(await setTaskEffort(S.convs[0], 'high')).toBe('pending_next_turn');
});

it('EFFORT-01: command_ack and unknown confirmations use unconfirmed wording, never applied wording', () => {
  expect(effortResult('observed', 'deep').text).toContain('已生效');
  expect(effortResult('pending_next_turn', 'deep').text).toContain('下一轮');
  for (const confirmation of ['command_ack', 'something_new']) {
    const r = effortResult(confirmation, 'deep');
    expect(r.text).toContain('无法确认');
    expect(r.text).not.toContain('已生效');
    expect(r.kind).toBe('info');
  }
});

it('EFFORT-01: a missing confirmation is treated as unconfirmed, never as applied', async () => {
  const { setConvOption } = await import('@/features/settings/runtime/agentOptions');
  update(s => { s.convs = [extConv('ag_q', 'Qoder')]; });
  withExtOptions();
  m.api.mockResolvedValueOnce({});
  // 核心没回 confirmation：不能当成「已生效」
  expect(await setConvOption(S.convs[0], 'thought_level', 'deep')).toBe('command_ack');
});

it('EFFORT-01: a response without config_options keeps the old tier and reports unconfirmed', async () => {
  const { setConvOption } = await import('@/features/settings/runtime/agentOptions');
  update(s => {
    s.convs = [extConv('ag_q', 'Qoder')];
    s.agentOptions[S.convs[0].id] = [
      { id: 'model', category: 'model', current_value: 'm1', options: [{ value: 'm1' }, { value: 'm2' }] },
      { id: 'thought_level', category: 'thought_level', current_value: 'fast', options: [{ value: 'fast' }, { value: 'deep' }] },
    ];
  });
  m.api.mockResolvedValueOnce({ confirmation: 'observed' }); // 核心只给了确认，没有回显选项
  const r = await setConvOption(S.convs[0], 'thought_level', 'deep');
  const thought = S.agentOptions[S.convs[0].id].find(o => o.id === 'thought_level')!;
  expect(thought.current_value).toBe('fast');
  expect(r).toBe('command_ack');
  expect(effortResult(r, 'deep').text).toContain('无法确认');
  expect(effortResult(r, 'deep').text).not.toContain('已生效');
});

it('EFFORT-01: a core echo that still shows the old tier is not reported as applied', async () => {
  const { setConvOption } = await import('@/features/settings/runtime/agentOptions');
  update(s => {
    s.convs = [extConv('ag_q', 'Qoder')];
    s.agentOptions[S.convs[0].id] = [
      { id: 'thought_level', category: 'thought_level', current_value: 'fast', options: [{ value: 'fast' }, { value: 'deep' }] },
    ];
  });
  m.api.mockResolvedValueOnce({ confirmation: 'observed', config_options: [{ id: 'thought_level', category: 'thought_level', current_value: 'fast', options: [{ value: 'fast' }, { value: 'deep' }] }] });
  const r = await setConvOption(S.convs[0], 'thought_level', 'deep');
  expect(S.agentOptions[S.convs[0].id][0].current_value).toBe('fast');
  expect(r).toBe('command_ack');
  expect(effortResult(r, 'deep').text).not.toContain('已生效');
});

it('EFFORT-01: an explicit pending confirmation is never reported as applied, even with a new echo', async () => {
  const { setConvOption } = await import('@/features/settings/runtime/agentOptions');
  update(s => {
    s.convs = [extConv('ag_q', 'Qoder')];
    s.agentOptions[S.convs[0].id] = [
      { id: 'thought_level', category: 'thought_level', current_value: 'fast', options: [{ value: 'fast' }, { value: 'deep' }] },
    ];
  });
  m.api.mockResolvedValueOnce({ confirmation: 'pending_next_turn', config_options: [{ id: 'thought_level', category: 'thought_level', current_value: 'deep', options: [{ value: 'fast' }, { value: 'deep' }] }] });
  const r = await setConvOption(S.convs[0], 'thought_level', 'deep');
  expect(S.agentOptions[S.convs[0].id][0].current_value).toBe('deep');
  expect(r).toBe('pending_next_turn');
  expect(effortResult(r, 'deep').text).toContain('下一轮');
  expect(effortResult(r, 'deep').text).not.toContain('已生效');
});

it('EFFORT-01: an observed echo updates the UI, and partial responses keep omitted options', async () => {
  const { setConvOption } = await import('@/features/settings/runtime/agentOptions');
  update(s => {
    s.convs = [extConv('ag_q', 'Qoder')];
    s.agentOptions[S.convs[0].id] = [
      { id: 'model', category: 'model', current_value: 'm1', options: [{ value: 'm1' }, { value: 'm2' }] },
      { id: 'thought_level', category: 'thought_level', current_value: 'fast', options: [{ value: 'fast' }, { value: 'deep' }] },
    ];
  });
  m.api.mockResolvedValueOnce({ confirmation: 'observed', config_options: [{ id: 'thought_level', category: 'thought_level', current_value: 'deep', options: [{ value: 'fast' }, { value: 'deep' }] }] });
  const r = await setConvOption(S.convs[0], 'thought_level', 'deep');
  expect(S.agentOptions[S.convs[0].id].map(o => o.id)).toEqual(['model', 'thought_level']);
  expect(S.agentOptions[S.convs[0].id][0].current_value).toBe('m1');
  expect(S.agentOptions[S.convs[0].id][1].current_value).toBe('deep');
  expect(r).toBe('observed');
  expect(effortResult(r, 'deep').text).toContain('已生效');
});
