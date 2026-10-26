import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { api, uploadFile } from '@/core/client';
import { loadHistory } from '@/features/chat/runtime/history';
import { beginConversationDrag, CONVERSATION_MIME, dropHistory, referenceConversation } from './historyImport';
vi.mock('@/core/client', async original => ({ ...await original<object>(), api: vi.fn(), uploadFile: vi.fn(async () => '/managed/history.md') }));
vi.mock('@/features/chat/runtime/history', () => ({ loadHistory: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  S.route = { name: 'chat' }; S.mode = 'desktop'; S.activeConv = 'target';
  S.drafts = { 'conv:target': '已有草稿' }; S.attachments = {};
  S.convs = [{ id: 'source', owner: 'pc', agentId: 'qoder', title: '项目进度', updated: 1, messages: [{ id: 'm', type: 'assistant', at: 1, text: '已经完成接口，下一步写测试' }] }];
});
it('references existing Agent sessions without navigation, execution, or source mutation; repeat drops are deduplicated', async () => {
  const original = JSON.stringify(S.convs);
  const values = new Map<string, string>();
  const data = { types: [CONVERSATION_MIME], setData: (k: string, v: string) => values.set(k, v), getData: (k: string) => values.get(k) || '' } as unknown as DataTransfer;
  beginConversationDrag(data, 'source');
  await dropHistory(data, 'conv:target');
  const draft = S.drafts['conv:target'];
  expect(draft).toBe('已有草稿');
  expect(S.attachments['conv:target'][0]).toMatchObject({ name: '项目进度', path: '/managed/history.md', kind: 'upload' });
  expect(uploadFile).toHaveBeenCalled();
  expect(S.activeConv).toBe('target'); expect(JSON.stringify(S.convs)).toBe(original);
  expect(S.attachments['conv:target']).toHaveLength(1);
  await dropHistory(data, 'conv:target'); expect(S.drafts['conv:target']).toBe(draft);
  expect(loadHistory).not.toHaveBeenCalled();
});
it('uses persistent remote history and leaves the draft intact on load failure', async () => {
  S.convs[0].remote = true;
  vi.mocked(loadHistory).mockRejectedValueOnce(new Error('无法读取历史'));
  await expect(referenceConversation('source', 'conv:target')).rejects.toThrow('无法读取历史');
  expect(S.drafts['conv:target']).toBe('已有草稿');
  vi.mocked(loadHistory).mockResolvedValueOnce({ messages: S.convs[0].messages });
  await referenceConversation('source', 'conv:target');
  expect(S.attachments['conv:target'][0].path).toBe('/managed/history.md');
});
it('does not overwrite drafts after navigation while history loads', async () => {
  S.convs[0].remote = true;
  vi.mocked(loadHistory).mockImplementationOnce(async () => { S.activeConv = 'other'; return { messages: S.convs[0].messages }; });
  await expect(referenceConversation('source', 'conv:target')).rejects.toThrow('会话已变化');
  expect(S.drafts['conv:target']).toBe('已有草稿');
});
it('supports phone and team composer drafts without filtering the source Agent', async () => {
  for (const key of ['conv:phone-target', 'team:t:member']) {
    await referenceConversation('source', key);
    expect(S.attachments[key][0].name).toBe('项目进度');
  }
  await expect(referenceConversation('source', 'conv:source')).rejects.toThrow('另一个会话');
  S.convs[0].messages[0].text = 'x'.repeat(1_000_001);
  await expect(referenceConversation('source', 'conv:target')).rejects.toThrow('上限');
  expect(S.drafts['conv:target']).toBe('已有草稿');
});

it('rejects a phone switch while loading history into the home composer', async () => {
  S.route = { name: 'home' }; S.mode = 'phone'; S.phoneId = 'phone-a'; S.convs[0].remote = true;
  S.drafts.home = '手机原草稿';
  vi.mocked(loadHistory).mockImplementationOnce(async () => { S.phoneId = 'phone-b'; return { messages: S.convs[0].messages }; });
  await expect(referenceConversation('source', 'home')).rejects.toThrow('会话已变化');
  expect(S.drafts.home).toBe('手机原草稿');
});

it.each([false, true])('HIST-02 a materialized imported conversation retains its original context when dragged again (new replies: %s)', async continued => {
  S.convs[0].remote = true; S.convs[0].historyArchiveId = 'archive-id'; S.convs[0].historyContextPath = '/archive/original.md';
  const messages = continued ? S.convs[0].messages : [];
  vi.mocked(loadHistory).mockResolvedValueOnce({ messages });
  vi.mocked(api).mockResolvedValueOnce({ transcript_path: '/archive/original.md', raw_path: '/archive/original.jsonl' });
  await referenceConversation('source', 'conv:target');
  expect(S.attachments['conv:target']).toHaveLength(1);
  expect(S.attachments['conv:target'][0]).toMatchObject({ name: '项目进度', path: '/managed/history.md', historyPaths: ['/archive/original.md', '/archive/original.jsonl'] });
  expect(S.drafts['conv:target']).toBe('已有草稿');
  expect(api).toHaveBeenCalledWith('POST', '/api/lom/history/archive-id/bundle', {});
});
