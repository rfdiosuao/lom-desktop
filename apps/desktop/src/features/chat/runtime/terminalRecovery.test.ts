import { beforeEach, describe, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { Conv } from '@/state/types';

const api = vi.fn();
vi.mock('@/core/client', () => ({ api: (...args: unknown[]) => api(...args), getEndpoint: () => null, fileStreamUrl: (p: string) => p }));
vi.mock('@/features/workspace/runtime/workspace', () => ({ refreshWorkspace: vi.fn(() => Promise.resolve()) }));
vi.mock('./taskSync', () => ({ refreshTaskList: vi.fn(() => Promise.resolve()) }));
vi.mock('@/app/sound', () => ({ taskFinished: vi.fn() }));
const { handleCoreEvent } = await import('./stream');
const { sendToTask } = await import('./tasks');
const { trackPendingSend, hasUnconfirmedSend } = await import('./cancel');
const { recoverTaskHistory } = await import('./recovery');

beforeEach(() => { api.mockReset(); });

describe('D26 核心完成早于发送 HTTP 返回', () => {
  it('旧成功记录与新未知发送同文同附件名时，重复恢复也不能冒充新发送凭据', async () => {
    const c: Conv = { id: 'unknown-identical', owner: 'pc', title: '任务', updated: 0, remote: true, loaded: true,
      agentId: 'codex', agentBackend: 'codex', messages: [{ id: 'new-user', type: 'user', at: 2, text: '继续',
        status: 'unconfirmed', attachments: [{ name: 'a.md', path: '/new/a.md' }] }] };
    update(s => { s.convs = [c]; s.running = { [c.id]: true }; s.providers = []; s.teams = []; s.goals = {}; });
    const lost = Promise.reject(new Error('core.response_lost'));
    trackPendingSend(c.id, lost, undefined, 'new-user');
    await expect(lost).rejects.toThrow('core.response_lost');
    await vi.waitFor(() => expect(hasUnconfirmedSend(c.id)).toBe(true));
    api.mockImplementation((_method: string, path: string) => {
      if (path.includes('/messages?')) return Promise.resolve({ items: [
        { id: 'old-user', msg_id: 'old-user', type: 'text', position: 'right', created_at: 1,
          content: { content: '继续\n\n[[AION_FILES]]\n/old/a.md' } },
      ], has_more_before: false });
      if (path.endsWith('/confirmations')) return Promise.resolve([]);
      return Promise.resolve({ runtime: { is_processing: false, turn_id: null }, extra: { backend: 'codex' } });
    });
    await recoverTaskHistory(c);
    await recoverTaskHistory(c);
    expect(hasUnconfirmedSend(c.id)).toBe(true); expect(S.running[c.id]).toBe(true);
    expect(c.messages.find(message => message.id === 'new-user')).toMatchObject({ status: 'unconfirmed', text: '继续' });
    expect(c.messages.find(message => message.id === 'new-user')?.remoteId).toBeUndefined();
    expect(c.messages.some(message => message.text === '已停止。')).toBe(false);
    expect(api.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  });

  it.each(['resolve', 'reject'])('POST 随后 %s 时，都自动恢复完整最终内容且解除忙碌状态', async outcome => {
    const c: Conv = { id: `terminal-${outcome}`, owner: 'pc', title: '任务', updated: 0, remote: true, loaded: true,
      agentId: 'codex', agentBackend: 'codex', messages: [] };
    update(s => { s.convs = [c]; s.running = {}; s.providers = []; s.teams = []; s.goals = {}; });
    let finish!: (value: { turn_id: string }) => void;
    let fail!: (error: Error) => void;
    let posting!: () => void;
    const posted = new Promise<void>(resolve => { posting = resolve; });
    const response = new Promise<{ turn_id: string }>((resolve, reject) => { finish = resolve; fail = reject; });
    api.mockImplementation((method: string, path: string) => {
      if (!path) throw new Error(`test.api_missing_path:${String(method)}`);
      if (method === 'POST' && path.endsWith('/messages')) { posting(); return response; }
      if (path.includes('/messages?')) return Promise.resolve({ items: [
        { id: 'user-server', msg_id: 'user-server', type: 'text', position: 'right', created_at: 1, content: { content: '问题' } },
        { id: 'reply', msg_id: 'reply', type: 'text', position: 'left', created_at: 2, content: { content: '最终完整回复' } },
      ], has_more_before: false });
      if (path.endsWith('/confirmations')) return Promise.resolve([]);
      return Promise.resolve({ runtime: { is_processing: false, turn_id: null }, extra: { backend: 'codex' } });
    });
    const sending = sendToTask(c, '问题', []);
    await posted;
    handleCoreEvent({ name: 'message.userCreated', data: { conversation_id: c.id, msg_id: 'user-server', content: '问题' } });
    handleCoreEvent({ name: 'message.stream', data: { conversation_id: c.id, msg_id: 'reply', turn_id: 'finished-turn', type: 'content', data: { content: '最终' } } });
    handleCoreEvent({ name: 'turn.completed', data: { conversation_id: c.id, turn_id: 'finished-turn', status: 'finished' } });
    expect(S.running[c.id]).toBe(true);
    if (outcome === 'resolve') finish({ turn_id: 'finished-turn' });
    else fail(new Error('core.response_lost'));
    expect(await sending).toBe(true);
    await vi.waitFor(() => {
      expect(S.running[c.id]).toBeUndefined();
      expect(c.messages.filter(message => message.type === 'assistant').map(message => message.text)).toEqual(['最终完整回复']);
    });
    expect(api.mock.calls.filter(([method]) => method === 'POST')).toHaveLength(1);
    expect(c.messages.filter(message => message.type === 'user')).toHaveLength(1);
  });
});
