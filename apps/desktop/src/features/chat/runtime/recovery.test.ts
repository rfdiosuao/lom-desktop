import { beforeEach, describe, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { Conv, Msg } from '@/state/types';

const { api, loadHistory, restoreConfirmations, toastError, pendingSends, hasInFlightSend, hasUnconfirmedSend, reconcileSendRegistrations } = vi.hoisted(() => ({
  api: vi.fn(), loadHistory: vi.fn(), restoreConfirmations: vi.fn(), toastError: vi.fn(),
  pendingSends: new Map<string, Promise<unknown>>(),
  hasInFlightSend: vi.fn(), hasUnconfirmedSend: vi.fn(), reconcileSendRegistrations: vi.fn(),
}));
vi.mock('@/core/client', () => ({ api }));
vi.mock('./history', () => ({ loadHistory }));
vi.mock('./tasks', () => ({ restoreConfirmations }));
vi.mock('./cancel', () => ({ pendingSends, hasInFlightSend, hasUnconfirmedSend, reconcileSendRegistrations }));
vi.mock('@/shared/overlays/controller', () => ({ toastError }));
const { recoverLoadedTasks, retryDeferredRecovery } = await import('./recovery');
const assistant = (text: string): Msg => ({ id: 'saved', type: 'assistant', at: 2, text, remoteId: 'reply' });
const runtime = (processing = false, turn = processing ? 'turn-old' : null) => ({
  runtime: { is_processing: processing, turn_id: turn, pending_confirmations: 0 },
});
let c: Conv;

beforeEach(() => {
  vi.clearAllMocks();
  api.mockReset(); loadHistory.mockReset(); pendingSends.clear();
  hasInFlightSend.mockImplementation((id: string) => pendingSends.has(id));
  hasUnconfirmedSend.mockReturnValue(false); reconcileSendRegistrations.mockReturnValue(true);
  c = { id: 'c1', owner: 'pc', title: '任务', updated: 0, loaded: true, remote: true,
    turnId: 'turn-old', messages: [{ ...assistant('部分'), id: 'local', streaming: true }] };
  update(s => {
    s.convs = [c]; s.running = { c1: true }; s.drafts = { 'conv:c1': '还没有发送的内容' };
    s.attachments = { 'conv:c1': [{ name: 'draft.md', path: '/draft.md' }] };
  });
  api.mockImplementation((_method: string, path: string) => Promise.resolve(path.endsWith('/confirmations') ? [] : runtime()));
  loadHistory.mockResolvedValue({ messages: [assistant('完整的最终回复')], previewFile: '/work/index.html' });
});

describe('D26 断线后的会话恢复', () => {
  it('恢复进行中的真实 Write 记录时保留执行状态，不制造成功文件和预览', async () => {
    const { mapHistory } = await vi.importActual<typeof import('./history')>('./history');
    c.preview = 'building';
    c.messages = [{ id: 'local-tool', type: 'tool', callId: 'write', at: 1, status: 'running' }];
    api.mockImplementation((_method: string, path: string) => Promise.resolve(path.endsWith('/confirmations') ? [] : runtime(true)));
    loadHistory.mockResolvedValue(mapHistory([{
      id: 'write', msg_id: 'write', conversation_id: c.id, type: 'tool_call', created_at: 1, status: 'work',
      content: { call_id: 'write', name: 'Write', status: 'running', args: { file_path: '/work/index.html', content: '<h1>尚未写入</h1>' } },
    }], c));
    await recoverLoadedTasks();
    expect(c.messages.map(message => message.type)).toEqual(['tool']);
    expect(c.messages[0].status).toBe('running'); expect(c.preview).toBe('building');
    expect(c.previewFile).toBeUndefined(); expect(S.running.c1).toBe(true);
  });

  it('补齐断线期间遗漏的最终文本并清除过期运行状态，同时保留草稿和附件', async () => {
    await recoverLoadedTasks();
    expect(c.messages).toEqual([assistant('完整的最终回复')]);
    expect(S.running.c1).toBeUndefined(); expect(c.turnId).toBeUndefined();
    expect(c.previewFile).toBe('/work/index.html');
    expect(S.drafts['conv:c1']).toBe('还没有发送的内容');
    expect(S.attachments['conv:c1'][0].path).toBe('/draft.md');
    expect(restoreConfirmations).toHaveBeenCalledWith(c, []);
  });

  it('恢复交互前从会话详情补齐实际后端身份', async () => {
    api.mockImplementation((_method: string, path: string) => Promise.resolve(path.endsWith('/confirmations') ? [] : {
      ...runtime(), extra: { backend: 'claude' },
    }));
    restoreConfirmations.mockImplementationOnce((restored: Conv) => expect(restored.agentBackend).toBe('claude'));
    await recoverLoadedTasks();
    expect(c.agentBackend).toBe('claude');
  });

  it('恢复快照落后于正在显示的实时文本时不截断文本', async () => {
    api.mockImplementation((_method: string, path: string) => Promise.resolve(path.endsWith('/confirmations') ? [] : runtime(true)));
    c.messages[0].text = '部分实时更新';
    loadHistory.mockResolvedValue({ messages: [assistant('部分')] });
    await recoverLoadedTasks();
    expect(c.messages[0]).toMatchObject({ text: '部分实时更新', streaming: true });
    expect(S.running.c1).toBe(true);
  });

  it('保留尚未持久化的用户消息和本地失败提示，并且不重复已确认的乐观消息', async () => {
    const user: Msg = { id: 'u-local', type: 'user', at: 1, text: '问题', attachments: [{ name: 'a.md', preview: 'local-preview' }] };
    c.messages = [user, c.messages[0], { id: 'notice', type: 'system', at: 3, text: '发送失败' },
      { id: 'new', type: 'user', at: 4, text: '尚未写入' }];
    loadHistory.mockResolvedValue({ messages: [{ ...user, id: 'u-server', remoteId: 'u-remote', attachments: [{ name: 'a.md' }] }, assistant('最终')] });
    await recoverLoadedTasks();
    expect(c.messages.map(m => m.text)).toEqual(['问题', '最终', '发送失败', '尚未写入']);
    expect(c.messages[0].attachments?.[0].preview).toBe('local-preview');
  });

  it('实时事件在读取期间到达时重读快照，保护该事件的文本', async () => {
    api.mockImplementation((_method: string, path: string) => Promise.resolve(path.endsWith('/confirmations') ? [] : runtime(true)));
    loadHistory.mockImplementationOnce(async () => {
      update(() => { c.messages[0].text = '部分新收到的内容'; });
      return { messages: [assistant('旧缓存')] };
    }).mockResolvedValue({ messages: [assistant('部分')] });
    await recoverLoadedTasks();
    expect(loadHistory).toHaveBeenCalledTimes(2);
    expect(c.messages[0].text).toBe('部分新收到的内容');
  });

  it('运行状态在历史读取期间变化时重新读取最终历史', async () => {
    let snapshot = 0;
    api.mockImplementation((_method: string, path: string) => Promise.resolve(path.endsWith('/confirmations') ? [] : runtime(++snapshot === 1)));
    loadHistory.mockResolvedValueOnce({ messages: [assistant('尚未结束')] }).mockResolvedValue({ messages: [assistant('最终')] });
    await recoverLoadedTasks();
    expect(loadHistory).toHaveBeenCalledTimes(2);
    expect(c.messages[0].text).toBe('最终'); expect(S.running.c1).toBeUndefined();
  });

  it('连续变化时保留实时状态，在完成事件后补齐遗漏内容', async () => {
    let part = 0;
    loadHistory.mockImplementation(async () => {
      if (++part <= 3) update(() => { c.messages[0].text = `实时 ${part}`; });
      return { messages: [assistant('最终')] };
    });
    await recoverLoadedTasks();
    expect(c.messages[0].text).toBe('实时 3'); expect(S.running.c1).toBe(true);
    retryDeferredRecovery(c.id);
    await vi.waitFor(() => expect(c.messages[0].text).toBe('最终'));
    expect(S.running.c1).toBeUndefined();
  });

  it('完成事件在恢复请求尚未结束时到达，也会触发最后一次权威恢复', async () => {
    loadHistory.mockImplementationOnce(async () => {
      update(s => { c.messages[0].streaming = false; delete s.running[c.id]; });
      retryDeferredRecovery(c.id);
      return { messages: [assistant('完成事件前的快照')] };
    }).mockResolvedValue({ messages: [assistant('完成之后的最终内容')] });
    await recoverLoadedTasks();
    await vi.waitFor(() => expect(c.messages[0].text).toBe('完成之后的最终内容'));
    expect(restoreConfirmations).toHaveBeenCalledTimes(1);
  });

  it('发送请求仍待确认时不被旧的空闲快照停止，发送返回后才恢复', async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    pendingSends.set(c.id, pending);
    await recoverLoadedTasks();
    expect(api).not.toHaveBeenCalled(); expect(S.running.c1).toBe(true);
    pendingSends.delete(c.id); finish();
    await vi.waitFor(() => expect(S.running.c1).toBeUndefined());
  });

  it('旧轮次结束不能消除仍可能登记新轮次的请求，登记结束后再恢复', async () => {
    pendingSends.set(c.id, new Promise(() => {}));
    await recoverLoadedTasks();
    update(() => { c.messages[0].streaming = false; });
    retryDeferredRecovery(c.id);
    await Promise.resolve();
    expect(S.running.c1).toBe(true); expect(api).not.toHaveBeenCalled();
    pendingSends.delete(c.id);
    retryDeferredRecovery(c.id);
    await vi.waitFor(() => expect(c.messages[0].text).toBe('完整的最终回复'));
    expect(S.running.c1).toBeUndefined();
  });

  it('空闲快照不足以清除未知登记，只有匹配已持久化的用户消息才能解除', async () => {
    let debt = true;
    c.messages = [{ id: 'local-user', type: 'user', at: 1, text: '待核对的问题', status: 'unconfirmed' }];
    hasInFlightSend.mockReturnValue(false); hasUnconfirmedSend.mockImplementation(() => debt);
    reconcileSendRegistrations.mockImplementation((_id: string, accepted: string[]) => {
      if (accepted.includes('local-user')) debt = false;
      return !debt;
    });
    loadHistory.mockResolvedValue({ messages: [] });
    await recoverLoadedTasks();
    expect(S.running.c1).toBe(true); expect(c.messages[0].status).toBe('unconfirmed');
    loadHistory.mockResolvedValue({ messages: [{ id: 'server-user', remoteId: 'accepted', type: 'user', at: 1, text: '待核对的问题' }] });
    // Exact message.userCreated/HTTP receipt proof, independent from a same-text history row.
    update(() => { c.messages[0].remoteId = 'accepted'; });
    retryDeferredRecovery(c.id);
    await vi.waitFor(() => expect(S.running.c1).toBeUndefined());
    expect(c.messages[0]).toMatchObject({ id: 'local-user', remoteId: 'accepted' });
    expect(c.messages[0].status).toBeUndefined();
    expect(api.mock.calls.every(call => call[0] === 'GET')).toBe(true);
  });

  it('任务已经移除时丢弃旧恢复响应', async () => {
    loadHistory.mockImplementation(async () => {
      update(s => { s.convs = []; });
      return { messages: [assistant('迟到的响应')] };
    });
    await recoverLoadedTasks();
    expect(c.messages[0].text).toBe('部分'); expect(restoreConfirmations).not.toHaveBeenCalled();
  });

  it('新的重连恢复已经完成时，旧重连响应不能覆盖它', async () => {
    let finish!: (value: { messages: Msg[] }) => void;
    let reading!: () => void;
    const started = new Promise<void>(resolve => { reading = resolve; });
    loadHistory.mockImplementationOnce(() => {
      reading(); return new Promise(resolve => { finish = resolve; });
    }).mockResolvedValue({ messages: [assistant('最新重连结果')] });
    const old = recoverLoadedTasks();
    await started;
    await recoverLoadedTasks();
    finish({ messages: [assistant('旧重连结果')] });
    await old;
    expect(c.messages[0].text).toBe('最新重连结果');
    expect(restoreConfirmations).toHaveBeenCalledTimes(1);
  });

  it('网络失败时报告恢复失败，并保留原始运行状态和消息', async () => {
    loadHistory.mockRejectedValue(new Error('core.offline'));
    await recoverLoadedTasks();
    expect(toastError).toHaveBeenCalled(); expect(c.messages[0].text).toBe('部分'); expect(S.running.c1).toBe(true);
  });
});
