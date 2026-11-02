import { beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { Conv, DraftAttachment } from '@/state/types';

const m = vi.hoisted(() => ({ phone: vi.fn() }));
vi.mock('@/features/phones/runtime/phoneChat', () => ({ sendPhone: m.phone, stopPhone: vi.fn(), watchPhone: vi.fn() }));
vi.mock('@/app/navigation', () => ({ navigate: (patch: object) => update(s => Object.assign(s, patch)), go: vi.fn() }));
import { send } from './composer';
import { beginAuthChange } from '@/features/account/runtime/authScope';

const key = 'conv:phone-draft';
const file: DraftAttachment = { name: 'old.txt', path: '/fixture/old.txt', kind: 'local' };
let c: Conv;
beforeEach(() => {
  vi.resetAllMocks(); m.phone.mockResolvedValue(undefined);
  c = { id: 'phone-draft', owner: 'dev_draft', phoneSession: 'session', title: '手机', updated: 1, messages: [] };
  S.convs = [c]; S.mode = 'phone'; S.phoneId = c.owner; S.activeConv = c.id;
  S.account = { id: 'phone14', name: 'Test', email: '' };
  S.agents[c.owner] = { id: c.owner, name: 'Phone', kind: 'phone', persona: '', real: true, status: 'online' };
  S.running = {}; S.drafts = { [key]: '  请打开应用  ' }; S.attachments = {}; S.turtles = {};
});

it.each(['absent', 'empty', 'files'])('PHONE-14 AC-1 acknowledged phone send clears an unchanged %s attachment draft', async kind => {
  if (kind !== 'absent') S.attachments[key] = kind === 'files' ? [file] : [];
  await send(key);
  expect(m.phone).toHaveBeenCalledWith(c, '请打开应用', kind === 'files' ? [file] : []);
  expect(S.drafts[key] || '').toBe('');
  expect(S.attachments[key] || []).toEqual([]);
});

it('PHONE-14 AC-2 initial phone send clears both home and the created conversation after acknowledgement', async () => {
  S.drafts.home = '手机新任务';
  let finish!: () => void;
  m.phone.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = send('home');
  const created = S.convs[0];
  expect(created).not.toBe(c);
  expect(S.drafts[`conv:${created.id}`]).toBe('手机新任务');
  expect(S.drafts.home).toBe('手机新任务');
  finish(); await pending;
  expect(S.drafts.home || '').toBe('');
  expect(S.drafts[`conv:${created.id}`] || '').toBe('');
});

it('PHONE-14 AC-2 an initial phone failure retains both draft copies without resending', async () => {
  S.drafts.home = '手机新任务'; S.attachments.home = [file];
  m.phone.mockRejectedValue(new Error('回执未知'));
  await send('home');
  const created = S.convs[0];
  expect(S.drafts.home).toBe('手机新任务');
  expect(S.drafts[`conv:${created.id}`]).toBe('手机新任务');
  expect(S.attachments[`conv:${created.id}`]).toEqual([file]);
  expect(m.phone).toHaveBeenCalledTimes(1);
});

it('PHONE-14 AC-4 a new home draft survives while its unchanged sent conversation is cleared', async () => {
  S.drafts.home = '手机任务';
  let finish!: () => void;
  m.phone.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = send('home');
  const created = S.convs[0];
  S.drafts.home = '另一项新任务';
  finish(); await pending;
  expect(S.drafts.home).toBe('另一项新任务');
  expect(S.drafts[`conv:${created.id}`] || '').toBe('');
});

it.each(['failed', 'unknown'])('PHONE-14 AC-3 %s send keeps the exact original prompt and attachments', async reason => {
  S.attachments[key] = [file];
  m.phone.mockRejectedValue(new Error(reason));
  await send(key);
  expect(S.drafts[key]).toBe('  请打开应用  ');
  expect(S.attachments[key]).toEqual([file]);
  expect(S.toast?.text).toContain('发送未确认');
});

it('PHONE-14 AC-4 a delayed acknowledgement preserves newer text and does not navigate back', async () => {
  let finish!: () => void;
  m.phone.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = send(key);
  S.drafts[key] = '新写的内容'; S.activeConv = 'other';
  finish(); await pending;
  expect(S.drafts[key]).toBe('新写的内容');
  expect(S.activeConv).toBe('other');
});

it('PHONE-14 AC-4 attachments added in place while waiting are neither sent nor erased by the old acknowledgement', async () => {
  S.attachments[key] = [file];
  let finish!: () => void;
  m.phone.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = send(key);
  const newer: DraftAttachment = { name: 'new.txt', path: '/fixture/new.txt', kind: 'local' };
  S.attachments[key].push(newer);
  expect(m.phone.mock.calls[0][2]).toEqual([file]);
  finish(); await pending;
  expect(S.attachments[key]).toEqual([file, newer]);
  expect(S.drafts[key]).toBe('  请打开应用  ');
});

it('PHONE-14 AC-4 equivalent empty attachment arrays do not leave a sent prompt stuck', async () => {
  S.attachments[key] = [];
  let finish!: () => void;
  m.phone.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = send(key);
  S.attachments[key] = [];
  finish(); await pending;
  expect(S.drafts[key] || '').toBe('');
});

it.each(['account', 'same-account-relogin', 'conversation', 'deleted', 'owner'])('PHONE-14 AC-5 %s changes prevent an old acknowledgement from clearing a replacement draft', async change => {
  S.attachments[key] = [];
  let finish!: () => void;
  m.phone.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = send(key);
  if (change === 'account') S.account = { id: 'new-account', name: 'New', email: '' };
  if (change === 'same-account-relogin') beginAuthChange();
  if (change === 'conversation') S.convs = [{ ...c }];
  if (change === 'deleted') S.convs = [];
  if (change === 'owner') c.owner = 'dev_other';
  finish(); await pending;
  expect(S.drafts[key]).toBe('  请打开应用  ');
});

it.each(['remove', 'replace', 'reorder'])('PHONE-14 AC-4 attachment %s while waiting preserves the draft', async change => {
  const other: DraftAttachment = { name: 'other.txt', path: '/fixture/other.txt', kind: 'local' };
  S.attachments[key] = [file, other];
  let finish!: () => void;
  m.phone.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = send(key);
  if (change === 'remove') S.attachments[key].pop();
  if (change === 'replace') S.attachments[key][0] = { ...file };
  if (change === 'reorder') S.attachments[key].reverse();
  finish(); await pending;
  expect(S.drafts[key]).toBe('  请打开应用  ');
  expect(S.attachments[key]).toHaveLength(change === 'remove' ? 1 : 2);
});

it('PHONE-14 AC-4 transfer metadata updates on the submitted attachments do not leave the prompt stuck', async () => {
  const attachment: DraftAttachment = { ...file, uploading: true };
  S.attachments[key] = [attachment];
  // Uploading desktop files are blocked by send(), so emulate transfer metadata only after dispatch.
  attachment.uploading = false;
  let finish!: () => void;
  m.phone.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = send(key);
  attachment.path = '/uploaded/old.txt';
  finish(); await pending;
  expect(S.drafts[key] || '').toBe('');
  expect(S.attachments[key] || []).toEqual([]);
});

it('PHONE-14 AC-5 changing the home phone preserves its composer but clears the sent conversation', async () => {
  S.drafts.home = '手机任务';
  S.attachments.home = [];
  let finish!: () => void;
  m.phone.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = send('home');
  const created = S.convs[0];
  S.phoneId = 'dev_other';
  finish(); await pending;
  expect(S.drafts.home).toBe('手机任务');
  expect(S.drafts[`conv:${created.id}`] || '').toBe('');
});
