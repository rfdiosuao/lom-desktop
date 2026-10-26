import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { continueHistory } from './historyContinuation';
import { GOAL_CONTINUE, continueGoal, retryTaskMessage, sendToTask } from '@/features/chat/runtime/tasks';
import { splitFilesMarker } from '@/features/chat/runtime/tools';
import { publicationPolicy } from '@/features/settings/runtime/preferences';

const m = vi.hoisted(() => ({ api: vi.fn(), endpoint: {}, open: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => m.endpoint }));
vi.mock('@/app/navigation', () => ({ openConv: m.open }));

const entry = { id: 'a'.repeat(64), source: 'codex' as const, title: '原始项目标题', session_id: 'original-session', cwd: '/old-work', digest: 'b'.repeat(64), bytes: 10, events: 3, warnings: [], timestamp: '' };
const BOTH = ['/archive/context.md', '/archive/raw.jsonl'];
const PREAMBLE = '请先读取附带的历史会话资料';

beforeEach(async () => {
  vi.clearAllMocks();
  S.cloud = 'signed-in'; S.account = { id: 'owner' } as any;
  S.mode = 'desktop'; S.route = { name: 'home' }; S.activeConv = null; S.modals = [];
  S.convs = []; S.historyImports = [entry]; S.agentPins = []; S.attachments = {}; S.drafts = {}; S.running = {};
  S.agentCatalog = [{ id: 'actual-codex', backend: 'codex', name: 'Codex CLI', enabled: true, installed: true, status: 'online', agent_type: 'acp', agent_source: 'builtin' }];
  m.api.mockImplementation(async (_method: string, path: string, body?: any) => path.endsWith('/bundle') ? { entry, transcript_path: '/archive/context.md', raw_path: '/archive/raw.jsonl' } : { id: 'continued', type: 'acp', name: body?.name, extra: body?.extra });
  await continueHistory(entry);
  S.attachments['conv:continued'] = [];
});

const requests = () => m.api.mock.calls.filter(call => call[1] === '/api/conversations/continued/messages').map(call => call[2] as { content: string; files: { path: string }[] });
const accept = (fail = 0) => {
  let failures = fail;
  m.api.mockImplementation(async (_method: string, path: string) => {
    if (!path.endsWith('/messages')) return {};
    if (failures-- > 0) throw Object.assign(new Error('rejected'), { status: 400 });
    return { turn_id: 'turn' };
  });
};

it('HIST-02 the imported history rides with the first question only; later turns and goal pushes do not re-attach it', async () => {
  accept();
  const c = S.convs[0];
  expect(await sendToTask(c, '第一问', [])).toBe(true);
  S.running = {};
  expect(await sendToTask(c, '第二问', [])).toBe(true);
  S.running = {};
  expect(await continueGoal(c)).toBe(true);
  const [first, second, push] = requests();
  expect(first.files.map(f => f.path)).toEqual(BOTH);
  expect(first.content).toContain(PREAMBLE);
  for (const later of [second, push]) {
    expect(later.files).toEqual([]);
    expect(later.content).not.toContain('LOM_HISTORY_CONTEXT_V1');
  }
  expect(second.content).toContain('第二问');
});

it('HIST-02 a failed first question does not count as delivered, so the retry still carries the history', async () => {
  accept(1);
  const c = S.convs[0];
  expect(await sendToTask(c, '第一问', [])).toBe(false);
  expect(await retryTaskMessage(c, c.messages.find(x => x.type === 'user')!)).toBe(true);
  const sent = requests();
  expect(sent).toHaveLength(2);
  for (const request of sent) {
    expect(request.files.map(f => f.path)).toEqual(BOTH);
    expect(request.content).toContain(PREAMBLE);
  }
});

it('HIST-02 a reference card dragged in later still delivers its own files and instruction after the first turn', async () => {
  accept();
  const c = S.convs[0];
  expect(await sendToTask(c, '第一问', [])).toBe(true);
  S.running = {};
  expect(await sendToTask(c, '参考这个', [{ name: '另一段', historyId: 'later', path: '/managed/later.md', kind: 'upload' }])).toBe(true);
  const later = requests()[1];
  expect(later.files.map(f => f.path)).toEqual(['/managed/later.md']);
  expect(later.content).toContain(PREAMBLE);
});

it('HIST-02 the hidden goal push stays hidden when the core echoes it back, with or without the first-turn history prefix', () => {
  const prefix = `[LOM_HISTORY_CONTEXT_V1]\n${PREAMBLE}\n[/LOM_HISTORY_CONTEXT_V1]\n\n`;
  expect(splitFilesMarker(`${publicationPolicy()}\n\n${GOAL_CONTINUE}`).text).toBe('');
  expect(splitFilesMarker(`${publicationPolicy()}\n\n${prefix}${GOAL_CONTINUE}`).text).toBe('');
  expect(splitFilesMarker(`${publicationPolicy()}\n\n${prefix}接着做`).text).toBe('接着做');
});
