import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { initialState } from '@/state/state';
import { audit, AUDIT_LIMIT, auditTrimmedCount, readAudit } from './audit';

const KEY = 'lom-audit-v1:local';
const row = (i: number) => ({ id: `c:${i}`, at: i, conversation: 'c', tool: 'Read', status: 'completed' });
const toastText = async () => { await vi.waitFor(() => expect(S.toast).not.toBeNull()); return S.toast!.text; };

beforeEach(() => {
  localStorage.clear(); Object.assign(S, initialState()); S.account = null; S.prefs.auditLog = true; S.toast = null;
  vi.restoreAllMocks();
});

it('SET-AUDIT-01 #430 数据损坏：备份原文、重建日志、继续记录，并如实报「数据损坏」而不是「存储空间」', async () => {
  localStorage.setItem(KEY, '{坏掉的数据');
  audit('c', 'one', 'Read', 'completed');
  expect(localStorage.getItem(`${KEY}:corrupt`)).toBe('{坏掉的数据');
  expect(readAudit().map(x => x.id)).toEqual(['c:one']);
  const text = await toastText();
  expect(text).toContain('audit.corrupt');
  expect(text).toContain('已备份');
  expect(text).not.toContain('存储空间');
  // 之后的记录继续正常写入，不再被静默丢弃
  audit('c', 'two', 'Write', 'completed');
  expect(readAudit()).toHaveLength(2);
});

it('SET-AUDIT-01 #430 内容不是列表同样算损坏并重建', async () => {
  localStorage.setItem(KEY, '{"a":1}');
  audit('c', 'one', 'Read', 'completed');
  expect(localStorage.getItem(`${KEY}:corrupt`)).toBe('{"a":1}');
  expect(readAudit()).toHaveLength(1);
  expect(await toastText()).toContain('audit.corrupt');
});

it('SET-AUDIT-01 #430 备份失败时不覆盖损坏的原数据，并如实提示', async () => {
  localStorage.setItem(KEY, 'xx');
  const set = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
    if (k.endsWith(':corrupt')) throw new DOMException('full', 'QuotaExceededError');
    return set.call(this, k, v);
  });
  audit('c', 'one', 'Read', 'completed');
  expect(localStorage.getItem(KEY)).toBe('xx');
  expect(await toastText()).toContain('audit.backup_failed');
});

it('SET-AUDIT-01 #430 只有真的写入失败才提示存储空间，并带错误码', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  audit('c', 'one', 'Read', 'completed');
  const text = await toastText();
  expect(text).toContain('audit.write_failed');
  expect(text).toContain('存储空间');
});

it('SET-AUDIT-01 #430 超过上限时删掉最早的记录，并记下删了多少条，供界面说明', () => {
  localStorage.setItem(KEY, JSON.stringify(Array.from({ length: AUDIT_LIMIT }, (_, i) => row(i))));
  expect(auditTrimmedCount()).toBe(0);
  audit('c', 'new', 'Read', 'completed');
  const items = readAudit();
  expect(items).toHaveLength(AUDIT_LIMIT);
  expect(items[0].id).toBe('c:1');
  expect(items.at(-1)?.id).toBe('c:new');
  expect(auditTrimmedCount()).toBe(1);
});
