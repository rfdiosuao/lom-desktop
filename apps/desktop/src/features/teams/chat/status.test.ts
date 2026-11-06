import { expect, it } from 'vitest';
import type { Conv, Msg } from '@/state/types';
import { isWorking, memberStatus, STATUS_TEXT } from './status';

const conv = (messages: Msg[]): Conv => ({ id: 'c', owner: 'pc', title: 'c', updated: 1, messages });
const user = (extra: Partial<Msg> = {}): Msg => ({ id: 'u', type: 'user', at: 1, text: '去做', ...extra });
const on = { running: true, connected: true, unsettled: false }, off = { running: false, connected: true, unsettled: false };

it('TEAM-CHAT-01C AC-C3 typing, tool running, waiting, failed, cancelled and completed are told apart from observed facts only', () => {
  expect(memberStatus(conv([user(), { id: 'a', type: 'assistant', at: 2, text: '正在', streaming: true }]), on)).toBe('typing');
  expect(memberStatus(conv([user(), { id: 't', type: 'tool', at: 2, status: 'running', tool: '抓取' }]), on)).toBe('tool');
  expect(memberStatus(conv([user()]), on)).toBe('running');
  expect(memberStatus(conv([user(), { id: 'p', type: 'approval', at: 2, status: 'pending', command: 'rm x' }]), off)).toBe('waiting');
  expect(memberStatus(conv([user({ turnOutcome: 'failed' })]), off)).toBe('failed');
  expect(memberStatus(conv([user({ turnOutcome: 'cancelled' })]), off)).toBe('cancelled');
  expect(memberStatus(conv([user({ turnOutcome: 'completed' }), { id: 'a', type: 'assistant', at: 2, text: '好了' }]), off)).toBe('completed');
  expect(STATUS_TEXT.completed).toBe('完成');
});

it('TEAM-CHAT-01C no terminal state is never shown as done; unknown sends stay unconfirmed', () => {
  expect(memberStatus(conv([user(), { id: 'a', type: 'assistant', at: 2, text: '好了' }]), off)).toBe('idle');
  // 成员来信触发的一轮没有用户消息：早先的「完成」不算这一轮的
  expect(memberStatus(conv([user({ turnOutcome: 'completed' }), { id: 'm', type: 'teammate', at: 3, text: '再查' }]), off)).toBe('idle');
  expect(memberStatus(conv([user({ status: 'unconfirmed' })]), off)).toBe('unconfirmed');
  expect(memberStatus(conv([user({ turnOutcome: 'completed' })]), { ...off, unsettled: true })).toBe('unconfirmed');
  expect(memberStatus(undefined, off)).toBe('idle');
});

it('TEAM-CHAT-01C AC-C4 a running member during a disconnect is shown as pending verification and stops animating', () => {
  const s = memberStatus(conv([user(), { id: 'a', type: 'assistant', at: 2, text: '正在', streaming: true }]), { ...on, connected: false });
  expect(s).toBe('disconnected');
  expect(isWorking(s)).toBe(false);
  expect(isWorking('typing')).toBe(true);
});
