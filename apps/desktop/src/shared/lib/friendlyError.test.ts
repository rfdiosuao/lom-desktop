import { expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { CoreError } from '@/core/client';
import { friendlyError } from './friendlyError';
import { quietError, toast, toastError } from '@/shared/overlays/controller';

it('D37 Chinese messages written in code are shown as written; developer code prefixes are dropped', () => {
  expect(friendlyError(new Error('任务还在执行，先停止再归档'))).toBe('任务还在执行，先停止再归档');
  expect(friendlyError(new Error('personal.permission_apply_failed：核心未确认权限更新，保留原档位'))).toBe('核心未确认权限更新，保留原档位');
  expect(friendlyError(new Error('feishu.auth_expired: 授权已过期，请重试'))).toBe('授权已过期，请重试');
});

it('D37 raw English from the core, network or OS never reaches the user', () => {
  expect(friendlyError(new CoreError('BAD_REQUEST', 'ongoing conversation jobs must keep their original assistant', 400))).toBe('这个定时任务固定在原会话里运行，不能更换助理');
  expect(friendlyError(new CoreError('BAD_REQUEST', 'extra.skills and MCP snapshots are immutable post-creation', 400))).toContain('创建时已固定');
  expect(friendlyError(new TypeError('Failed to fetch'))).toContain('连接不上');
  expect(friendlyError(new CoreError('X', 'boom', 503))).toContain('服务暂时出了点问题');
  expect(friendlyError(new CoreError('X', 'nope', 401))).toContain('重新登录');
  expect(friendlyError(new Error('thread panicked at src/lib.rs:42'))).toBe('没有完成，请重试');
  expect(friendlyError(undefined)).toBe('没有完成，请重试');
});

it('D37 error toasts read as errors (not the green success icon), stay longer, and log the raw detail', () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  toastError('模型同步失败，未创建任务', new CoreError('BAD_REQUEST', 'ongoing conversation jobs must keep their original assistant', 400));
  expect(S.toast).toMatchObject({ tone: 'error', text: '模型同步失败，未创建任务：这个定时任务固定在原会话里运行，不能更换助理' });
  expect(log).toHaveBeenCalled();
  vi.advanceTimersByTime(3000); expect(S.toast).not.toBeNull();
  vi.advanceTimersByTime(2000); expect(S.toast).toBeNull();
  toast('已归档', 'archive'); expect(S.toast?.tone).toBe('ok');
  toast('请先选择文件夹', 'info'); expect(S.toast?.tone).toBe('info');
  log.mockRestore(); vi.useRealTimers();
});

it('D37 background syncs fail quietly into the log', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  S.toast = null;
  quietError('sync.account_failed', new Error('offline'));
  expect(S.toast).toBeNull(); expect(warn).toHaveBeenCalledWith('sync.account_failed', expect.any(Error));
  warn.mockRestore();
});
