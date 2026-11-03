import { expect, it } from 'vitest';
import { activityErrorText } from './activityErrors';

/* UI-AUDIT-04 F-07：团队活动读取失败只显示友好原因和固定错误码，不显示核心或网络的原始报错。 */

const coreError = (code: string, message: string) => Object.assign(new Error(message), { code });

it.each([
  ['LOM_CORE_NOT_READY', '核心服务还没有启动', 'Lom 核心服务还没有启动，稍后重试（team.activity_core_not_ready）'],
  ['LOM_CORE_UNREACHABLE', '无法连接核心服务（TypeError: Failed to fetch）', '连接不上 Lom 核心服务，请确认 Lom 仍在运行后重试（team.activity_unreachable）'],
  ['LOM_CORE_CANCELLED', '请求已取消或超时，执行状态尚未确认', '读取超时，请重试（team.activity_timeout）'],
  ['LOM_CORE_BAD_RESPONSE', '核心服务返回了无法解析的内容（HTTP 502）', '核心服务返回了无法识别的内容，请重试（team.activity_bad_response）'],
])('UI-AUDIT-04 maps core error %s to a friendly reason with a fixed code', (code, raw, friendly) => {
  expect(activityErrorText(coreError(code, raw))).toBe(friendly);
});

it.each([
  ['an unknown core code', coreError('HTTP_500', 'internal server error: panicked at team.rs')],
  ['a plain error', new Error('socket hang up')],
  ['a native string rejection', 'team.not_found'],
  ['nothing', undefined],
])('UI-AUDIT-04 %s falls back to team.activity_failed without leaking the raw text', (_label, error) => {
  const text = activityErrorText(error);
  expect(text).toBe('团队活动暂时读不到，请重试（team.activity_failed）');
});
