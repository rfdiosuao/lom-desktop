import { beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('./phoneRpc', () => ({ phoneRpc: rpc }));
import { phoneDocument, syncPhoneDocuments, writePhoneDocument } from './phoneDocuments';
import { loadPhoneCache, savePhoneCache } from './phoneCache';
import { pickPhone } from '@/app/navigation';
import { beginAuthChange } from '@/features/account/runtime/authScope';

const doc = (text: string, revision = '1') => ({ name: 'SOUL.md', text, revision, modified: 1 });
let sequence = 0;
let a: string, b: string;
beforeEach(() => {
  rpc.mockReset(); sequence++;
  a = `dev_d26_a_${sequence}`; b = `dev_d26_b_${sequence}`;
  update(s => {
    s.cloud = 'signed-in'; s.account = { id: `draft-account-${sequence}`, name: 'Draft', email: '' };
    s.phoneId = a; s.route = { name: 'phone-soul' }; s.soulDirty = {}; s.modals = [];
    for (const id of [a, b]) s.agents[id] = { id, name: id, kind: 'phone', real: true, status: 'online', persona: '' };
  });
  loadPhoneCache();
  rpc.mockImplementation(async (_device, method) => method === 'document.list' ? { items: [doc('', '1')] } : doc('saved', '1'));
});

it('D26 switching phones preserves each unsaved SOUL and the revision editing began with', async () => {
  await syncPhoneDocuments(a);
  S.souls[a] = 'unsaved A'; S.soulDirty[a] = true;
  pickPhone(b); S.souls[b] = 'unsaved B'; S.soulDirty[b] = true;
  rpc.mockClear(); await syncPhoneDocuments(a);
  expect(S.souls[a]).toBe('unsaved A');
  expect(S.soulDirty[a]).toBe(true); expect(S.soulDirty[b]).toBe(true);
  expect(rpc.mock.calls.some(c => c[1] === 'document.read')).toBe(false);
  expect(phoneDocument(a, 'SOUL.md')?.revision).toBe('1');
  pickPhone(a); expect(S.souls[a]).toBe('unsaved A');
});

it('D26 a delayed read cannot replace a draft begun before switching away', async () => {
  await syncPhoneDocuments(a);
  let finish!: (value: ReturnType<typeof doc>) => void;
  rpc.mockImplementation(async (_device, method) => method === 'document.list' ? { items: [doc('', '2')] }
    : new Promise<ReturnType<typeof doc>>(resolve => { finish = resolve; }));
  const pending = syncPhoneDocuments(a);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  S.souls[a] = 'edited during read'; S.soulDirty[a] = true; pickPhone(b);
  finish(doc('new remote content', '2')); await pending;
  expect(S.souls[a]).toBe('edited during read');
  expect(phoneDocument(a, 'SOUL.md')?.revision).toBe('1');
});

it('D26 saving one phone neither clears another draft nor overwrites newer edits on the saved phone', async () => {
  await syncPhoneDocuments(a);
  S.souls[a] = 'submitted'; S.soulDirty[a] = true;
  let finish!: (value: ReturnType<typeof doc>) => void;
  rpc.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = writePhoneDocument(a, 'SOUL.md', 'submitted');
  S.souls[a] = 'newer edit'; S.soulDirty[a] = true;
  pickPhone(b); S.souls[b] = 'other edit'; S.soulDirty[b] = true;
  finish(doc('submitted', '2')); await pending;
  expect(S.souls[a]).toBe('newer edit'); expect(S.soulDirty[a]).toBe(true);
  expect(S.souls[b]).toBe('other edit'); expect(S.soulDirty[b]).toBe(true);
  const cached = JSON.parse(localStorage.getItem(`lom.phone-cache.v1:${S.account!.id}`)!);
  expect(cached.souls[a]).toBe('submitted'); expect(cached.souls[b]).toBeUndefined();
});

it('D26 background cache writes retain confirmed SOUL content and never persist unsaved edits', async () => {
  await syncPhoneDocuments(a);
  S.souls[a] = 'private unsaved'; S.soulDirty[a] = true;
  S.souls[b] = 'new unsaved'; S.soulDirty[b] = true;
  await savePhoneCache();
  const cached = JSON.parse(localStorage.getItem(`lom.phone-cache.v1:${S.account!.id}`)!);
  expect(cached.souls[a]).toBe('saved'); expect(cached.souls[b]).toBeUndefined();
  expect(JSON.stringify(cached)).not.toContain('unsaved');
});

it('D26 late document reads cannot restore content after logout and same-account login', async () => {
  let finish!: (value: ReturnType<typeof doc>) => void;
  rpc.mockImplementation(async (_device, method) => method === 'document.list' ? { items: [doc('', '1')] }
    : new Promise<ReturnType<typeof doc>>(resolve => { finish = resolve; }));
  const pending = syncPhoneDocuments(a);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  beginAuthChange();
  S.souls[a] = 'new session content';
  finish(doc('old session content')); await pending;
  expect(S.souls[a]).toBe('new session content');
  expect(phoneDocument(a, 'SOUL.md')).toBeUndefined();
});

it('D26 late save acknowledgements cannot replace another account draft or cache', async () => {
  await syncPhoneDocuments(a); S.souls[a] = 'submitted'; S.soulDirty[a] = true;
  let finish!: (value: ReturnType<typeof doc>) => void;
  rpc.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = writePhoneDocument(a, 'SOUL.md', 'submitted');
  beginAuthChange(); S.account = { id: 'new-account', name: 'New', email: '' };
  S.souls[a] = 'new account draft';
  finish(doc('submitted', '2'));
  await expect(pending).rejects.toThrow('登录状态已变化');
  expect(S.souls[a]).toBe('new account draft'); expect(S.soulDirty[a]).toBe(true);
  expect(localStorage.getItem('lom.phone-cache.v1:new-account')).toBeNull();
});
