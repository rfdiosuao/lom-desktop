import { expect, it } from 'vitest';
import { personalError } from './errors';
it.each(['personal.mkdir', 'personal.template_create', 'personal.template_write', 'personal.data_dir', 'personal.unsafe_path', 'personal.invalid_identity'])('PA-CREATE preserves safe native error code %s', code => {
  expect(personalError(code)).toContain(code);
  expect(personalError(new Error(code))).toBe(personalError(code));
});
it('PA-CREATE reports name and avatar validation instead of blaming file access', () => {
  expect(personalError(new Error('助理名称须为1至40个字符'))).toBe('助理名称须为1至40个字符');
  expect(personalError(new Error('请选择有效的助理形象'))).toBe('请选择有效的助理形象');
});
it('PA-CREATE does not expose arbitrary native or provider payloads', () => {
  for (const value of ['secret-key /private/path', new Error('secret-key /private/path'), { message: 'secret-key /private/path' }]) {
    expect(personalError(value)).not.toContain('secret-key');
    expect(personalError(value)).not.toContain('/private/path');
  }
});
it.each(['QuotaExceededError', 'SecurityError'])('PA-CREATE identifies local profile storage error %s', name => {
  expect(personalError(new DOMException('/private/path secret-key', name))).toContain('无法保存本机助理配置');
  expect(personalError(new DOMException('/private/path secret-key', name))).not.toContain('secret-key');
});
it('PA-CREATE reports damaged profile storage separately', () => {
  expect(personalError(new Error('助理配置损坏，请先恢复备份'))).toContain('恢复备份');
});
it('PA-CREATE reports model readiness instead of asking the user to sign in again', () => {
  expect(personalError(new Error('Lom账号模型尚未连接，请恢复连接后重试'))).toContain('模型');
});
