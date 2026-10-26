import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setEndpoint } from '@/core/client';
import { S } from '@/state/store';
import { referenceHistory, type HistoryEntry } from './historyImport';
const entry: HistoryEntry = { id: 'a'.repeat(64), digest: 'b'.repeat(64), title: '继续项目', source: 'codex', session_id: 'native', cwd: '/项目', timestamp: '', bytes: 100, events: 3, warnings: [] };
beforeEach(() => { setEndpoint({ url: 'http://127.0.0.1:1234', token: 'test' } as any); S.mode = 'desktop'; S.route = { name: 'chat' }; S.activeConv = 'target'; S.drafts = { 'conv:target': '原草稿' }; S.attachments = {}; S.modals = []; });
afterEach(() => { setEndpoint(null as any); vi.unstubAllGlobals(); });
it('HIST-01 attaches actual handoff files, preserves the draft and never sends a message', async () => {
  const requests: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => { requests.push(url); return new Response(JSON.stringify({ success: true, data: { entry, transcript_path: '/archive/a.md', raw_path: '/archive/a.jsonl' } })); });
  await referenceHistory(entry);
  expect(S.drafts['conv:target']).toBe('原草稿');
  expect(S.attachments['conv:target'][0].name).toBe('继续项目');
  expect(S.attachments['conv:target'].map(a => a.path)).toEqual(['/archive/a.md']);
  expect(requests).toEqual([`http://127.0.0.1:1234/api/lom/history/${entry.id}/bundle`]);
  await referenceHistory(entry); expect(S.attachments['conv:target']).toHaveLength(1);
});
it('HIST-01 a failed bundle leaves the original draft and attachments intact', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: false, error: 'archive missing' }), { status: 400 }));
  await expect(referenceHistory(entry)).rejects.toThrow('archive missing');
  expect(S.drafts['conv:target']).toBe('原草稿'); expect(S.attachments).toEqual({});
});
it('HIST-01 changing the target while loading never places history into the wrong conversation', async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal('fetch', () => new Promise<Response>(r => { resolve = r; }));
  const pending = referenceHistory(entry); S.activeConv = 'other';
  resolve(new Response(JSON.stringify({ data: { entry, transcript_path: '/a.md', raw_path: '/a.jsonl' } })));
  await expect(pending).rejects.toThrow('目标会话已切换'); expect(S.attachments).toEqual({});
});

it('HIST-02 a removed reference can be attached again without modifying the typed draft', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: { entry, transcript_path: '/archive/a.md', raw_path: '/archive/a.jsonl' } })));
  await referenceHistory(entry);
  await referenceHistory(entry); expect(S.attachments['conv:target']).toHaveLength(1);
  S.attachments['conv:target'] = [];
  await referenceHistory(entry); expect(S.attachments['conv:target']).toHaveLength(1);
  expect(S.drafts['conv:target']).toBe('原草稿');
});
