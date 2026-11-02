import { beforeEach, describe, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { Conv } from '@/state/types';

/* 不连真实的 lom-core：接口调用、工作区刷新、列表刷新全部替换掉 */
const api = vi.fn();
const evolve = vi.hoisted(() => vi.fn((..._args: unknown[]) => Promise.resolve()));
vi.mock('@/features/personal/runtime/evolution', () => ({ evolvePersonalTurn: (...a: unknown[]) => evolve(...a), waitPersonalLearning: () => Promise.resolve() }));
vi.mock('@/core/client', () => ({ api: (...a: unknown[]) => api(...a), fileStreamUrl: (p: string) => `stream:${p}` }));
vi.mock('@/features/workspace/runtime/workspace', () => ({ refreshWorkspace: vi.fn(() => Promise.resolve()) }));
vi.mock('./taskSync', () => ({ refreshTaskList: vi.fn(() => Promise.resolve()) }));
vi.mock('./recovery', () => ({ recoverTaskHistory: vi.fn(() => Promise.resolve()) }));

const { handleCoreEvent } = await import('./stream');
const { stopTask } = await import('./tasks');
const { trackPendingSend, hasInFlightSend } = await import('./cancel');

const WS = '/Users/me/Documents/Lom';
const stream = (type: string, data: Record<string, unknown> = {}, msg = 'm1') =>
  handleCoreEvent({ name: 'message.stream', data: { conversation_id: 'c1', msg_id: msg, turn_id: 'turn_1', type, data } });

let conv: Conv;
beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue({});
  conv = { id: 'c1', owner: 'pc', title: '做网站', updated: 0, remote: true, loaded: true, workspace: WS, messages: [] };
  update(s => { s.convs = [conv]; s.permission = 'ask'; s.running = {}; });
});

describe('D01 §2.4 lom-core 事件 → 界面', () => {
  it('D01 AC-2 流式回复、写文件、确认、完成的完整一轮', () => {
    update(() => { conv.messages.push({ id: 'u', type: 'user', at: 0, text: '做一个网站' }); });
    handleCoreEvent({ name: 'message.userCreated', data: { conversation_id: 'c1', msg_id: 'u1', content: '做一个网站' } });
    stream('start');
    stream('content', { content: '好的，' });
    stream('content', { content: '我先生成页面。' });
    stream('tool_call', { call_id: 'aionrs-call_1', name: 'Write', status: 'running', args: { file_path: `${WS}/index.html`, content: '<h1>hi</h1>' } });
    expect(conv.preview).toBe('building');
    stream('acp_permission', { id: 'conf_1', call_id: 'call_1', title: 'edit wants to use: Write', action: 'Write', description: 'Write to index.html', options: [] });
    stream('tool_call', { call_id: 'aionrs-call_1', name: 'Write', status: 'completed', output: 'Created index.html' });
    stream('content', { content: '页面已经生成好了' }, 'm2');
    stream('finish');
    handleCoreEvent({ name: 'turn.completed', data: { conversation_id: 'c1', status: 'finished' } });

    expect(conv.messages.map(m => m.type)).toEqual(['user', 'assistant', 'tool', 'approval', 'files', 'assistant']);
    expect(conv.messages[0].remoteId).toBe('u1');
    expect(conv.messages[1].text).toBe('好的，我先生成页面。');
    expect(conv.messages[2]).toMatchObject({ tool: '写入文件', status: 'done' });
    expect(conv.messages[3]).toMatchObject({ command: '写入文件 · index.html', status: 'pending', confirmId: 'conf_1', callId: 'call_1' });
    expect(conv.messages[4].changes).toEqual([{ path: 'index.html', add: 1, del: 0 }]);
    expect(conv.preview).toBe('ready');
    expect(conv.previewFile).toBe(`${WS}/index.html`);
    expect(conv.turnId).toBe('turn_1');
    expect(S.running.c1).toBeUndefined();
    expect(conv.messages.some(m => m.streaming)).toBe(false);
  });

  it('D01 AC-4 只读规划：提交核心提供的拒绝选项，确认后再提示', async () => {
    update(s => { s.permission = 'readonly'; });
    stream('tool_call', { call_id: 'aionrs-call_9', name: 'Write', args: { file_path: `${WS}/a.html`, content: 'x' } });
    stream('acp_permission', { id: 'conf_9', call_id: 'call_9', title: 't', action: 'Write', description: 'Write to a.html', options: [{ label: 'Allow', value: 'proceed_once' }, { label: 'Reject', value: 'cancel' }] });
    await vi.waitFor(() => expect(conv.messages.find(m => m.type === 'approval')?.status).toBe('denied'));
    expect(conv.messages.at(-1)).toMatchObject({ type: 'system', text: '已提交拒绝这一步的决定。' });
    expect(api).toHaveBeenCalledWith('POST', '/api/conversations/c1/confirmations/call_9/confirm', { msg_id: 'conf_9', data: { value: 'cancel' }, always_allow: false });
  });

  it('D01 这一轮异常结束时给出提示，转圈的工具卡片改为失败', () => {
    stream('tool_call', { call_id: 'call_5', name: 'ExecCommand', args: { command: 'npm i' } });
    handleCoreEvent({ name: 'turn.completed', data: { conversation_id: 'c1', status: 'error' } });
    expect(conv.messages[0].status).toBe('error');
    expect(conv.messages.at(-1)?.text).toContain('没有正常完成');
  });

  it('S04-01 AC-5 Lom 云端任务的额度报错显示为「积分不足」，自带 Key 的任务原样显示', () => {
    update(s => {
      s.providers = [{ id: 'p_cloud', platform: 'openai', name: 'Lom 云端', base_url: 'x', models: [], enabled: true, created_at: 0 }];
      conv.providerId = 'p_cloud';
    });
    stream('error', { message: '用户额度不足, 剩余额度: 0' });
    expect(conv.messages.at(-1)?.text).toContain('积分不足');
    update(() => { conv.providerId = 'p_own'; });
    stream('error', { message: 'Invalid token' });
    expect(conv.messages.at(-1)?.text).toBe('Invalid token');
  });

  it('带附件的用户消息：核心回推的版本带 [[AION_FILES]] 标记，不再重复显示一条', () => {
    update(() => { conv.messages.push({ id: 'u', type: 'user', at: 0, text: '看看这张图', attachments: [{ name: 'a.png', ic: 'image', preview: 'blob:x' }] }); });
    handleCoreEvent({ name: 'message.userCreated', data: { conversation_id: 'c1', msg_id: 'u9', content: '看看这张图\n\n[[AION_FILES]]\n/up/a.png' } });
    expect(conv.messages.filter(m => m.type === 'user')).toHaveLength(1);
    expect(conv.messages[0].remoteId).toBe('u9');
    // 从别处（例如定时任务）发来的消息：正文和附件分开显示
    handleCoreEvent({ name: 'message.userCreated', data: { conversation_id: 'c1', msg_id: 'u10', content: '日报\n\n[[AION_FILES]]\n/up/b.png' } });
    expect(conv.messages.at(-1)).toMatchObject({ text: '日报', attachments: [{ name: 'b.png', ic: 'image', preview: 'stream:/up/b.png' }] });
  });

  it('D01 不属于电脑任务的会话事件被忽略', () => {
    handleCoreEvent({ name: 'message.stream', data: { conversation_id: 'other', msg_id: 'x', type: 'content', data: { content: 'hi' } } });
    expect(conv.messages).toHaveLength(0);
  });

  it('D26 迟到的旧轮次完成事件不能停止新轮次或结算它的工具', () => {
    update(s => {
      s.running.c1 = true; conv.turnId = 'new-turn';
      conv.messages.push({ id: 'tool-live', type: 'tool', at: 1, status: 'running', streaming: true });
    });
    handleCoreEvent({ name: 'turn.completed', data: { conversation_id: 'c1', turn_id: 'old-turn', status: 'cancelled' } });
    expect(S.running.c1).toBe(true);
    expect(conv.messages[0]).toMatchObject({ status: 'running', streaming: true });
  });

  it('D26 当前轮次结束时仍有新发送登记，保持运行以便继续停止新轮次', async () => {
    let finish!: (value: { turn_id: string }) => void;
    const pending = new Promise<{ turn_id: string }>(resolve => { finish = resolve; });
    trackPendingSend(conv.id, pending);
    update(s => { s.running.c1 = true; conv.turnId = 'old-turn'; });
    handleCoreEvent({ name: 'turn.completed', data: { conversation_id: 'c1', turn_id: 'old-turn', status: 'cancelled' } });
    expect(S.running.c1).toBe(true);
    finish({ turn_id: 'new-turn' });
    await vi.waitFor(() => expect(hasInFlightSend(conv.id)).toBe(false));
  });
});

describe('D01 AC-5 停止任务', () => {
  it('使用服务端当前轮编号而非缓存，并等待停止确认', async () => {
    update(s => { conv.turnId = 'stale'; s.running.c1 = true; conv.messages.push({ id: 'a', type: 'approval', at: 0, status: 'pending' }); });
    let resolveCancel: (v: unknown) => void = () => {};
    api.mockImplementation((method: string) => method === 'GET'
      ? Promise.resolve({ runtime: { turn_id: 'current', is_processing: true } })
      : new Promise(resolve => { resolveCancel = resolve; }));
    const stopping = stopTask('c1');
    await vi.waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/api/conversations/c1/cancel', { turn_id: 'current' }, expect.anything()));
    expect(S.running.c1).toBe(true);
    expect(conv.messages.some(m => m.text === '已停止。')).toBe(false);
    resolveCancel({ runtime: { turn_id: null, is_processing: false } });
    await stopping;
    expect(S.running.c1).toBeUndefined();
    expect(conv.messages[0].status).toBe('denied');
  });

  it('取消接口拒绝时保留运行状态，不报告成功', async () => {
    update(s => { s.running.c1 = true; });
    api.mockImplementation((method: string) => method === 'GET'
      ? Promise.resolve({ runtime: { turn_id: 'current', is_processing: true } })
      : Promise.reject(new Error('Invalid JSON request body')));
    await stopTask('c1');
    expect(S.running.c1).toBe(true);
    expect(conv.messages.some(m => m.text === '已停止。')).toBe(false);
  });

  it('取消已接收但仍在执行时继续查询，最终停止后才结束', async () => {
    update(s => { s.running.c1 = true; });
    api.mockResolvedValueOnce({ runtime: { turn_id: 'current', is_processing: true } })
      .mockResolvedValueOnce({ runtime: { turn_id: 'current', is_processing: true } })
      .mockResolvedValueOnce({ runtime: { turn_id: null, is_processing: false } });
    await stopTask('c1');
    expect(api).toHaveBeenCalledTimes(3);
    expect(S.running.c1).toBeUndefined();
  });
});

it('D11 实时 Codex 生图工具结果进入图片消息，前后文字按顺序显示', () => {
  stream('content', { content: '给你画一只小狗。' });
  stream('acp_tool_call', { update: { tool_call_id: 'ig', title: 'imageGeneration' } });
  stream('acp_tool_call', { update: { tool_call_id: 'ig', status: 'completed', rawOutput: { saved_path: '/work/dog.png' } } });
  stream('content', { content: '完成了。' }, 'm2');
  expect(conv.messages.map(m => m.type)).toEqual(['assistant', 'tool', 'assistant']);
  expect(conv.messages[1].images).toEqual(['/work/dog.png']);
  expect(conv.messages[0].streaming).toBe(false);
});

it('D11 统一 Session 生图完成事件保留图片输出', () => {
  stream('tool_call', { call_id: 'ig2', name: 'imageGeneration', status: 'running' });
  stream('tool_call', { call_id: 'ig2', status: 'completed', output: JSON.stringify({ kind: 'lom.tool-output.v1', text: '', images: ['/work/dog.png'] }) });
  expect(conv.messages[0].images).toEqual(['/work/dog.png']);
});

it('PA-EVOLVE-02 successful completion triggers learning and cancellation does not', () => {
  evolve.mockClear(); conv.turnId = 'turn_1';
  handleCoreEvent({name:'turn.completed', data:{conversation_id:'c1', turn_id:'turn_1', status:'cancelled'}});
  expect(evolve).not.toHaveBeenCalled();
  handleCoreEvent({name:'turn.completed', data:{conversation_id:'c1', turn_id:'turn_1', status:'finished'}});
  expect(evolve).toHaveBeenCalledWith(conv, 'turn_1');
});
