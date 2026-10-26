import { beforeEach, describe, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { Conv } from '@/state/types';

const listTasks = vi.fn();
vi.mock('./history', () => ({ listTasks: (...args: unknown[]) => listTasks(...args) }));
const { refreshTaskList } = await import('./taskSync');
const task = (id: string): Conv => ({ id, owner: 'pc', title: id, updated: 0, remote: true, messages: [] });

beforeEach(() => {
  listTasks.mockReset();
  update(s => { s.convs = [task('existing')]; s.tasksLoaded = false; s.sideChat = null; });
});

describe('D26 重新同步任务列表', () => {
  it('同步元数据时保留已加载的消息与运行状态', async () => {
    const c = S.convs[0]; c.loaded = true; c.messages.push({ id: 'm', type: 'assistant', at: 1, text: '实时内容' });
    listTasks.mockResolvedValue([{ ...task(c.id), title: '服务器名称', updated: 2 }]);
    await refreshTaskList();
    expect(S.convs[0]).toBe(c); expect(c.messages[0].text).toBe('实时内容');
    expect(c.title).toBe('服务器名称'); expect(S.tasksLoaded).toBe(true);
  });

  it('现有任务的后端身份只能由服务器会话元数据补齐', async () => {
    const c = S.convs[0];
    listTasks.mockResolvedValue([{ ...task(c.id), agentBackend: 'claude' }]);
    await refreshTaskList();
    expect(c.agentBackend).toBe('claude');
  });

  it('读取列表期间新建的任务不能被旧列表移除，同时正确移除服务器删除的旧任务', async () => {
    let finish!: (items: Conv[]) => void;
    listTasks.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = refreshTaskList();
    const created = task('created-while-fetching');
    update(s => { s.convs.unshift(created); });
    finish([]);
    await pending;
    expect(S.convs).toEqual([created]);
  });

  it('并发列表响应乱序时采用最近发起的结果', async () => {
    let finish!: (items: Conv[]) => void;
    listTasks.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce([task('new')]);
    const old = refreshTaskList();
    await refreshTaskList();
    finish([task('stale')]);
    await old;
    expect(S.convs.map(c => c.id)).toEqual(['new']);
  });
});
