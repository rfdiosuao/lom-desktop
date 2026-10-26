import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { api } from '@/core/client';
import { continueHistory } from './historyContinuation';
import { historyAgents } from '@/state/history';
const m = vi.hoisted(() => ({ api: vi.fn(), endpoint: {}, open: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => m.endpoint }));
vi.mock('@/app/navigation', () => ({ openConv: m.open }));
const entry = { id: 'a'.repeat(64), source: 'codex' as const, title: '原始项目标题', session_id: 'original-session', cwd: '/old-work', digest: 'b'.repeat(64), bytes: 10, events: 3, warnings: [], timestamp: '' };
beforeEach(() => {
  vi.clearAllMocks();
  S.cloud = 'signed-in'; S.account = { id: 'owner' } as any;
  S.mode = 'desktop'; S.route = { name: 'home' }; S.activeConv = null; S.modals = [];
  S.convs = []; S.historyImports = [entry]; S.agentPins = []; S.attachments = {}; S.drafts = { home: '不要覆盖' }; S.running = {};
  S.agentCatalog = [{ id: 'actual-codex', backend: 'codex', name: 'Codex CLI', enabled: true, installed: true, status: 'online', agent_type: 'acp', agent_source: 'builtin' }];
  m.api.mockImplementation(async (_method: string, path: string, body?: any) => path.endsWith('/bundle') ? { entry, transcript_path: '/archive/context.md', raw_path: '/archive/raw.jsonl' } : { id: 'continued', type: 'acp', name: body.name, extra: body.extra });
});
it('HIST-02 original CLI category contains imported titles and opening creates a real ACP conversation with backing context, without sending', async () => {
  expect(historyAgents().find(a => a.id === 'actual-codex')?.count).toBe(1);
  expect(historyAgents().some(a => a.id.startsWith('archive:'))).toBe(false);
  await continueHistory(entry);
  expect(api).toHaveBeenCalledWith('POST', '/api/conversations', expect.objectContaining({ type: 'acp', name: entry.title, extra: expect.objectContaining({ agent_id: 'actual-codex', backend: 'codex', lom_history_id: entry.id, lom_history_context: '/archive/context.md' }) }));
  expect(S.convs[0]).toMatchObject({ agentId: 'actual-codex', historyContextPath: '/archive/context.md' });
  expect(S.drafts.home).toBe('不要覆盖');
  expect(S.attachments['conv:continued'][0]).toMatchObject({ name: entry.title, path: '/archive/context.md', historyId: entry.id });
  expect(m.api.mock.calls.some(call => call[1].endsWith('/messages'))).toBe(false);
  expect(m.open).toHaveBeenCalledWith('continued');
  expect(historyAgents().find(a => a.id === 'actual-codex')?.count).toBe(1);
  await continueHistory(entry);
  expect(m.api).toHaveBeenCalledTimes(2);
});
it('HIST-02 double clicks create one conversation; unavailable CLI cannot create a fake chat', async () => {
  await Promise.all([continueHistory(entry), continueHistory(entry)]);
  expect(m.api.mock.calls.filter(call => call[1] === '/api/conversations')).toHaveLength(1);
  S.convs = []; S.agentCatalog = [];
  await expect(continueHistory(entry)).rejects.toThrow('连接对应的 CLI');
});

it('HIST-02 sending a new question actually forwards historical context to the original CLI, including after draft cards were cleared', async () => {
  await continueHistory(entry);
  m.api.mockImplementation(async (_method: string, path: string) => path.endsWith('/messages') ? { turn_id: 'turn' } : {});
  const { sendToTask } = await import('@/features/chat/runtime/tasks');
  S.attachments['conv:continued'] = [];
  expect(await sendToTask(S.convs[0], '接着做下一步', [])).toBe(true);
  const request = m.api.mock.calls.find(call => call[1] === '/api/conversations/continued/messages')![2];
  expect(request.files).toEqual([{ kind: 'local', path: '/archive/context.md' }, { kind: 'local', path: '/archive/raw.jsonl' }]);
  expect(request.content).toContain('请先读取附带的历史会话资料');
  expect(request.content).toContain('接着做下一步');
  expect(request.content).not.toContain('original-session');
});

it('HIST-02 a single cross-Agent reference card sends both the original archive and its continuation file', async () => {
  const { sendToTask } = await import('@/features/chat/runtime/tasks');
  const target = { id: 'cross-target', owner: 'pc', remote: true, agentId: 'claude', title: '另一会话', updated: 1, messages: [] };
  S.convs.push(target);
  m.api.mockResolvedValue({ turn_id: 'cross-turn' });
  expect(await sendToTask(target, '参考这个继续做', [{ name: '历史标题', historyId: 'ref', path: '/managed/continued.md', kind: 'upload', historyPaths: ['/archive/original.md'] }])).toBe(true);
  const request = m.api.mock.calls.find(call => call[1] === '/api/conversations/cross-target/messages')![2];
  expect(request.files).toEqual([{ kind: 'upload', path: '/managed/continued.md' }, { kind: 'local', path: '/archive/original.md' }]);
});

it('HIST-02 a reference dropped into a new CLI task retains original history after first-send failure and retry', async () => {
  const { startDesktopTask, retryTaskMessage } = await import('@/features/chat/runtime/tasks');
  let failures = 1;
  m.api.mockImplementation(async (_method: string, path: string, body?: any) => {
    if (path === '/api/conversations') return { id: 'retry-task', type: 'acp', extra: body.extra };
    if (path.endsWith('/messages')) {
      if (failures-- > 0) throw Object.assign(new Error('rejected'), { status: 400 });
      return { turn_id: 'retry-ok' };
    }
    return {};
  });
  const reference = { name: '历史标题', historyId: 'ref', path: '/managed/continued.md', kind: 'upload' as const, historyPaths: ['/archive/original.md'] };
  await startDesktopTask('接着做', [reference], { agent: S.agentCatalog![0] });
  const conversation = S.convs.find(c => c.id === 'retry-task')!;
  await vi.waitFor(() => expect(conversation.messages[0].status).toBe('error'));
  expect(await retryTaskMessage(conversation, conversation.messages[0])).toBe(true);
  const sent = m.api.mock.calls.filter(call => call[1] === '/api/conversations/retry-task/messages');
  expect(sent).toHaveLength(2);
  for (const request of sent) expect(request[2].files).toEqual([{ kind: 'upload', path: '/managed/continued.md' }, { kind: 'local', path: '/archive/original.md' }]);
});
