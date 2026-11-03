import { beforeEach, expect, it, vi } from 'vitest';
import { keepInvalid, readJson, writeJson } from './localCache';

const isList = (v: unknown) => (Array.isArray(v) ? v as string[] : undefined);
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

it('REFACTOR-01-M7 AC-1 读取结果明确区分没有、损坏、版本不认识、存储不可用，从不抛错', () => {
  expect(readJson('k', isList)).toEqual({ status: 'missing' });
  localStorage.setItem('k', '{'); expect(readJson('k', isList)).toEqual({ status: 'invalid', raw: '{' });
  localStorage.setItem('k', '{"version":2}'); expect(readJson('k', isList)).toEqual({ status: 'invalid', raw: '{"version":2}' });
  localStorage.setItem('k', '["a"]'); expect(readJson('k', isList)).toEqual({ status: 'ok', value: ['a'] });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
  expect(readJson('k', isList)).toEqual({ status: 'unavailable' });
});

it('REFACTOR-01-M7 AC-2 写满与存储不可用分开报告', () => {
  expect(writeJson('k', [1])).toBe('ok');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new DOMException('full', 'QuotaExceededError'); });
  expect(writeJson('k', [2])).toBe('quota');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('blocked'); });
  expect(writeJson('k', [3])).toBe('unavailable');
  expect(localStorage.getItem('k')).toBe('[1]');
});

it('REFACTOR-01-M7 AC-3 损坏原文另存一次，原键不被删除', () => {
  localStorage.setItem('k', '{');
  expect(keepInvalid('k', '{')).toBe('ok');
  expect(localStorage.getItem('k.invalid')).toBe('{');
  expect(localStorage.getItem('k')).toBe('{');
  const set = vi.spyOn(Storage.prototype, 'setItem');
  keepInvalid('k', '{'); expect(set).not.toHaveBeenCalled();
});
