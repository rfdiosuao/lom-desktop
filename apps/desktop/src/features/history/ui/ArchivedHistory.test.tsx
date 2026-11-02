import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';
import type { HistoryEntry } from '@/core/types';
const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', async load => ({ ...await load<typeof import('@/core/client')>(), api: m.api }));
import { ImportedHistoryRows } from './ImportedHistoryRows';
import { ArchivedModal } from '@/features/chat/ui/CommandModals';
import { archiveTask, restoreTask } from '@/features/chat/runtime/commands';
import { listTasks } from '@/features/chat/runtime/history';
import { historyAgentId } from '@/state/history';

let host: HTMLDivElement, root: Root;
const entry = (id: string, title: string) => ({ id, source: 'codex', title, updated_at: 1 } as unknown as HistoryEntry);
const task = (id: string, history?: string): Conv => ({ id, owner: 'pc', title: id, updated: 1, messages: [], remote: true, historyArchiveId: history } as Conv);
const rows = () => [...host.querySelectorAll('.conv__title')].map(x => x.textContent);
const render = async (node: React.ReactNode) => { await act(async () => root.render(node)); };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  m.api.mockReset(); m.api.mockResolvedValue({});
  S.historyImportError = ''; S.historyHidden = []; S.running = {}; S.agentCatalog = null; S.historyAgentPick = 'history:codex';
  S.historyImports = [entry('h1', '修登录页'), entry('h2', '写周报')];
  S.convs = [task('t1', 'h1')];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('D34 archiving a task continued from imported history makes it disappear, history row included; restoring brings it back', async () => {
  expect(historyAgentId()).toBe('history:codex');
  await render(<ImportedHistoryRows />);
  expect(rows()).toEqual(['写周报']);
  await act(async () => { await archiveTask(S.convs[0]); });
  expect(S.convs).toEqual([]);
  expect(rows()).toEqual(['写周报']);
  m.api.mockResolvedValueOnce({}).mockResolvedValueOnce({ id: 't1', type: 'aionrs', name: 't1', created_at: 1, extra: { lom_history_id: 'h1' } });
  await act(async () => { await restoreTask('t1'); });
  expect(S.historyHidden).toEqual([]);
  expect(S.convs.map(c => c.historyArchiveId)).toEqual(['h1']);
  expect(rows()).toEqual(['写周报']);
});

it('D34 tasks archived earlier also keep their source history out of the list after a refresh', async () => {
  S.convs = [];
  m.api.mockImplementation(async (_m: string, path: string) => {
    if (path.startsWith('/api/conversations?')) return { items: [], has_more: false };
    if (path.startsWith('/api/sidebar?archived=1')) return { groups: [{ scope: { type: 'chats' }, items: [{ type: 'conversation', conversation: { id: 't1', extra: { lom_history_id: 'h1' } } }] }] };
    return {};
  });
  await listTasks();
  await render(<ImportedHistoryRows />);
  expect(rows()).toEqual(['写周报']);
});

it('D34 an imported row can be removed from the list and restored from the archived dialog', async () => {
  S.convs = [];
  await render(<ImportedHistoryRows />);
  await act(async () => { (host.querySelector('[aria-label="移出列表"]') as HTMLButtonElement).click(); });
  expect(rows()).toEqual(['写周报']);
  m.api.mockResolvedValue({ groups: [] });
  await render(<ArchivedModal />);
  expect(host.textContent).toContain('修登录页');
  expect(host.textContent).toContain('已移出列表');
  const restore = [...host.querySelectorAll('button')].find(b => b.textContent === '恢复')!;
  await act(async () => { restore.click(); });
  expect(S.historyHidden).toEqual([]);
});
