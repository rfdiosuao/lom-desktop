import { beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { Conv, DraftAttachment } from '@/state/types';
const m = vi.hoisted(() => ({ send: vi.fn(), start: vi.fn(), resend: vi.fn(), phone: vi.fn() }));
vi.mock('../runtime/tasks', () => ({
  sendToTask: m.send, startDesktopTask: m.start, stopTask: vi.fn(), approveTask: vi.fn(), applyModeToTask: vi.fn(), applyModelToTask: vi.fn(),
}));
vi.mock('../runtime/conversationSend', () => ({ resendToConversation: m.resend }));
vi.mock('@/features/phones/runtime/phoneChat', () => ({ sendPhone: m.phone, stopPhone: vi.fn(), watchPhone: vi.fn() }));
vi.mock('@/app/navigation', () => ({ navigate: (patch: object) => update(s => Object.assign(s, patch)), go: vi.fn() }));
import { regenerate, send } from './composer';

const file: DraftAttachment = { name: 'only-copy.md', path: '/selected/only-copy.md', kind: 'local' };
const task = (): Conv => ({ id: 'draft-task', owner: 'pc', title: 'Task', updated: 1, remote: true, messages: [] });
beforeEach(() => {
  vi.clearAllMocks(); S.mode = 'desktop'; S.convs = [task()]; S.running = {}; S.toast = null;
  S.drafts = { 'conv:draft-task': '  original draft  ' }; S.attachments = { 'conv:draft-task': [file] };
});

it('D26 a failed send restores the exact draft and reusable attachments to its original conversation', async () => {
  let finish!: (ok: boolean) => void;
  m.send.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const pending = send('conv:draft-task');
  expect(S.drafts['conv:draft-task']).toBe('');
  expect(S.attachments['conv:draft-task']).toEqual([]);
  S.activeConv = 'other'; S.drafts['conv:other'] = 'other draft';
  finish(false); await pending;
  expect(S.drafts['conv:draft-task']).toBe('  original draft  ');
  expect(S.attachments['conv:draft-task']).toEqual([file]);
  expect(S.drafts['conv:other']).toBe('other draft');
});

it('D26 a failed send does not overwrite text or attachments entered while waiting', async () => {
  let finish!: (ok: boolean) => void;
  m.send.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const pending = send('conv:draft-task');
  const next = { name: 'next.txt', path: '/selected/next.txt' };
  update(s => { s.drafts['conv:draft-task'] = 'new draft'; s.attachments['conv:draft-task'] = [next]; });
  finish(false); await pending;
  expect(S.drafts['conv:draft-task']).toBe('new draft');
  expect(S.attachments['conv:draft-task']).toEqual([next]);
});

it('D26 an initial-message failure restores the created conversation instead of the home composer', async () => {
  let fail!: (c: Conv) => void;
  m.start.mockImplementation(async (_text, _atts, options) => { fail = options.onSendFailure; return 'created'; });
  S.drafts.home = 'first question'; S.attachments.home = [file];
  await send('home');
  S.drafts.home = 'next home draft';
  fail({ ...task(), id: 'created' });
  expect(S.activeConv).toBe('created');
  expect(S.drafts['conv:created']).toBe('first question');
  expect(S.attachments['conv:created']).toEqual([file]);
  expect(S.drafts.home).toBe('next home draft');
});

it('D26 an initial-message failure preserves a fresh draft in the created conversation', async () => {
  let fail!: (c: Conv) => void;
  m.start.mockImplementation(async (_text, _atts, options) => { fail = options.onSendFailure; return 'created'; });
  S.drafts.home = 'first question';
  await send('home'); S.drafts['conv:created'] = 'follow-up';
  fail({ ...task(), id: 'created' });
  expect(S.drafts['conv:created']).toBe('follow-up');
});

it('D26 regenerating an attachment-only message resends its usable path and original upload kind', async () => {
  const c = S.convs[0], attachment = { ...file, ic: 'file' as const, path: '/uploads/shared/only-copy.md', kind: 'upload' as const };
  const reply = { id: 'reply', type: 'assistant' as const, at: 2, text: 'reply' };
  c.messages = [{ id: 'user', type: 'user', at: 1, text: '', attachments: [attachment] }, reply];
  m.resend.mockResolvedValue(true);
  await regenerate(`conv:${c.id}`, reply);
  expect(m.resend).toHaveBeenCalledWith(c, '', [attachment]);
});

it('D26 regeneration asks for missing original files instead of silently resending without them', async () => {
  const c = S.convs[0], reply = { id: 'reply', type: 'assistant' as const, at: 2, text: 'reply' };
  c.messages = [{ id: 'user', type: 'user', at: 1, text: 'read this', attachments: [{ name: 'unavailable.md' }] }, reply];
  await regenerate(c.id, reply);
  expect(m.resend).not.toHaveBeenCalled();
  expect(S.toast?.text).toContain('重新添加附件');
});

it('D26 regeneration reports a stale reply instead of resending the last user message', async () => {
  const c = S.convs[0];
  c.messages = [{ id: 'user', type: 'user', at: 1, text: 'old question' }];
  await regenerate(c.id, { id: 'gone', type: 'assistant', at: 2, text: 'old reply' });
  expect(m.resend).not.toHaveBeenCalled();
  expect(S.toast?.text).toContain('重新生成失败');
  expect(S.toast?.text).toContain('已不在当前会话');
});

it('D26 a delayed phone acknowledgement preserves newly entered content and the current navigation', async () => {
  const c = S.convs[0]; c.remote = false; c.owner = 'dev_d26_phone';
  S.agents[c.owner] = { id: c.owner, name: 'Phone', kind: 'phone', persona: '', real: true, status: 'online' };
  let finish!: () => void;
  m.phone.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = send(`conv:${c.id}`);
  S.drafts[`conv:${c.id}`] = 'new phone draft'; S.activeConv = 'another-conversation';
  finish(); await pending;
  expect(S.drafts[`conv:${c.id}`]).toBe('new phone draft');
  expect(S.attachments[`conv:${c.id}`]).toEqual([file]);
  expect(S.activeConv).toBe('another-conversation');
});
