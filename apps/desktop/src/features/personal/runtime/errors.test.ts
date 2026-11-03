import { expect, it } from 'vitest';
import { CoreError } from '@/core/client';
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
it('UI-AUDIT-03 AC-2 已知原因的核心错误说明原因和下一步，且不回显原始返回内容', () => {
  expect(personalError(new CoreError('LOM_CORE_UNREACHABLE', '无法连接核心服务（secret-key /private/path）'))).toBe('无法连接 Lom 核心服务，请等核心恢复连接后重试。');
  expect(personalError(new CoreError('LOM_CORE_CANCELLED', '请求已取消或超时，执行状态尚未确认'))).toContain('结果尚未确认；请重新同步');
  expect(personalError(new CoreError('HTTP_500', 'secret-key /private/path', 500))).toBe('Lom 核心服务暂时无法处理，请稍后重试。');
  expect(personalError(new Error('助理会话归属不一致，请核对后再打开'))).toBe('助理会话归属不一致，已停止操作；请重新同步任务后再试。');
  expect(personalError(new Error('secret-key /private/path'))).toBe('出现未识别的错误，请重试；仍失败时请反馈操作步骤。');
});
it('UI-AUDIT-03 AC-2 定时任务的归属检查失败也用同一中性说明，不说成停止打开', () => {
  for (const text of ['助理会话归属不一致', '定时任务的助理归属不一致']) expect(personalError(new Error(text))).toBe('助理会话归属不一致，已停止操作；请重新同步任务后再试。');
});
it('UI-AUDIT-03 AC-2 会话未就绪先于账号规则识别，提示说明会话未打开或账号已切换', () => {
  expect(personalError(new Error('会话尚未就绪或账号已切换'))).toBe('会话还没有打开或账号已切换，请重新打开助理后再试。');
  expect(personalError(new Error('账号已切换，未关联目录'))).toBe('账号状态已变化，请登录后重新打开助理。');
});
