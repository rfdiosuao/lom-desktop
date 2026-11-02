import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { UserMessage } from './UserMessage';
const resend = vi.fn();
const retry = vi.fn();
const check = vi.fn();
vi.mock('../actions/message', () => ({ resendEditedMessage: (...args: unknown[]) => resend(...args), retryFailedMessage: (...args: unknown[]) => retry(...args), checkUnconfirmedMessage: (...args: unknown[]) => check(...args) }));
let host: HTMLDivElement, root: Root;
const message = { id: 'm1', type: 'user' as const, at: 1, text: '原始消息' };
const click = async (label: string) => { await act(async () => { (host.querySelector(`[aria-label="${label}"]`) || [...host.querySelectorAll('button')].find(x => x.textContent === label))?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  resend.mockReset(); retry.mockReset(); check.mockReset(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(<UserMessage m={message} ctxId="task" />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('D-MESSAGE 复制用户消息原文', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  await click('复制消息'); expect(writeText).toHaveBeenCalledWith('原始消息');
});
it('D-MESSAGE 编辑取消不发送，不改原消息', async () => {
  await click('编辑消息'); expect(host.querySelector('textarea')?.value).toBe(message.text);
  await click('取消'); expect(resend).not.toHaveBeenCalled(); expect(message.text).toBe('原始消息');
});
it('D-MESSAGE 发送失败保留编辑框，成功后关闭', async () => {
  resend.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await click('编辑消息'); await click('发送修改');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('已保留'); expect(host.querySelector('textarea')).not.toBeNull();
  await click('发送修改'); expect(host.querySelector('textarea')).toBeNull(); expect(message.text).toBe('原始消息');
});
it('D-MESSAGE 执行中禁止编辑，复制仍可用', async () => {
  S.running.task = true;
  await act(async () => root.render(<UserMessage m={message} ctxId="task" />));
  expect((host.querySelector('[aria-label="编辑消息"]') as HTMLButtonElement).disabled).toBe(true);
  expect((host.querySelector('[aria-label="复制消息"]') as HTMLButtonElement).disabled).toBe(false);
});

it('D-MESSAGE 修改后的文字才会提交，原记录不被覆盖', async () => {
  resend.mockResolvedValue(true); await click('编辑消息');
  const input = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '修改后的消息');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('发送修改');
  expect(resend).toHaveBeenCalledWith('task', message, '修改后的消息');
  expect(message.text).toBe('原始消息');
});

it('D04 scheduled prompt has an explicit source, remains copyable and cannot edit the schedule through chat', async () => {
  await act(async () => root.render(<UserMessage m={{ ...message, source: 'schedule' }} ctxId="task" />));
  expect(host.textContent).toContain('由定时任务发送');
  expect(host.textContent).toContain('原始消息');
  expect(host.querySelector('[aria-label="复制消息"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="编辑消息"]')).toBeNull();
});

it('D16 team-prefixed messages disable edit while their real conversation is running', async () => {
  S.running = { task: true };
  await act(async () => root.render(<UserMessage m={message} ctxId="conv:task" />));
  expect((host.querySelector('[aria-label="编辑消息"]') as HTMLButtonElement).disabled).toBe(true);
  expect((host.querySelector('[aria-label="复制消息"]') as HTMLButtonElement).disabled).toBe(false);
});

it('D26 failed-message retry submits the clicked snapshot and remains disabled during an active turn', async () => {
  const failed = { ...message, status: 'error' as const, text: '', attachments: [{ name: 'only-copy.md', path: '/selected/only-copy.md' }] };
  retry.mockResolvedValue(true);
  await act(async () => root.render(<UserMessage m={failed} ctxId="conv:task" />));
  await click('重新发送'); expect(retry).toHaveBeenCalledWith('conv:task', failed);
  S.running.task = true;
  await act(async () => root.render(<UserMessage m={failed} ctxId="conv:task" />));
  const button = [...host.querySelectorAll('button')].find(x => x.textContent === '重新发送')!;
  expect(button.disabled).toBe(true);
});

it('D26 uncertain sends expose a record check without offering blind retry', async () => {
  check.mockResolvedValue(undefined);
  await act(async () => root.render(<UserMessage m={{ ...message, status: 'unconfirmed' }} ctxId="conv:task" />));
  expect(host.textContent).toContain('发送结果未确认');
  expect([...host.querySelectorAll('button')].some(button => button.textContent === '重新发送')).toBe(false);
  await click('核对记录'); expect(check).toHaveBeenCalledWith('conv:task');
  expect(resend).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled();
});
