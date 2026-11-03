import { afterEach, expect, it, vi } from 'vitest';
import { toolMsg } from './tools';
import { applyAcpTool } from './toolImages';
import { mapHistory } from './history';
import { recoveredMessages } from './recoveredMessages';
import { elapsedText } from './activityTiming';
import type { Msg } from '@/state/types';
const conv = { id: 'timing', owner: 'pc', title: '计时', updated: 1, messages: [] };
afterEach(() => vi.useRealTimers());

it('CHAT-ACTIVITY-01 AC-8 new tool records capture the observed start', () => {
  vi.useFakeTimers(); vi.setSystemTime(1_000);
  expect(toolMsg('call', 'Read', {}).timing).toEqual({ startedAt: 1_000 });
});

it('CHAT-ACTIVITY-01 AC-8 ACP captures terminal time once and does not invent a start for terminal-only records', () => {
  const messages: Msg[] = [];
  applyAcpTool(messages, { update: { tool_call_id: 'a', status: 'in_progress' } }, 1_000);
  applyAcpTool(messages, { update: { tool_call_id: 'a', status: 'completed' } }, 2_500);
  applyAcpTool(messages, { update: { tool_call_id: 'a', status: 'completed' } }, 9_000);
  expect(messages[0].timing).toEqual({ startedAt: 1_000, endedAt: 2_500 });
  applyAcpTool(messages, { update: { tool_call_id: 'unknown', status: 'completed' } }, 10_000);
  expect(messages[1].timing).toBeUndefined();
});

it('CHAT-ACTIVITY-01 AC-9 history uses explicit start/end records and keeps terminal-only timing unknown', () => {
  const row = (id: string, status: string, at: number) => ({ id: `${id}:${status}`, msg_id: id, conversation_id: 'timing', type: 'tool_call', created_at: at, content: { call_id: id, name: 'Read', status } });
  const { messages } = mapHistory([row('a', 'running', 1_000), row('a', 'completed', 2_500), row('old', 'completed', 4_000)], conv);
  expect(messages[0].timing).toEqual({ startedAt: 1_000, endedAt: 2_500 });
  expect(messages[1].timing).toBeUndefined();
});

it('CHAT-ACTIVITY-01 AC-9 recovery retains already observed timing', () => {
  const local = { id: 'local', callId: 'a', type: 'tool', at: 1, status: 'done', timing: { startedAt: 1_000, endedAt: 2_500 } } as Msg;
  const saved = { id: 'server', callId: 'a', type: 'tool', at: 1, status: 'done' } as Msg;
  expect(recoveredMessages([saved], [local], false)[0].timing).toEqual({ startedAt: 1_000, endedAt: 2_500 });
});

it('CHAT-ACTIVITY-01 AC-9 partial history timing cannot erase an observed end', () => {
  const local = { id: 'local', callId: 'a', type: 'tool', at: 1, status: 'done', timing: { startedAt: 1_000, endedAt: 2_500 } } as Msg;
  const saved = { id: 'server', callId: 'a', type: 'tool', at: 1, status: 'done', timing: { startedAt: 900 } } as Msg;
  expect(recoveredMessages([saved], [local], false)[0].timing).toEqual({ startedAt: 1_000, endedAt: 2_500 });
});

it('CHAT-ACTIVITY-01 AC-9 ACP history with missing timestamps never uses the page-open time', () => {
  const row = (status: string, at: number) => ({ id: status, msg_id: status, conversation_id: 'timing', type: 'acp_tool_call', created_at: at, content: { update: { tool_call_id: 'acp', status } } });
  for (const times of [[0, 0], [1_000, 0], [0, 2_000]]) {
    const { messages } = mapHistory([row('in_progress', times[0]), row('completed', times[1])], conv);
    expect(messages[0].timing?.endedAt).toBeUndefined();
    if (!times[0]) expect(messages[0].timing).toBeUndefined();
  }
});

it('CHAT-ACTIVITY-01 AC-8 durations always round down, including tenths below ten seconds', () => {
  expect(elapsedText(9_960, false)).toBe('9.9 秒');
  expect(elapsedText(1_049, false)).toBe('1 秒');
  expect(elapsedText(59_999, false)).toBe('59 秒');
  expect(elapsedText(119_999, false)).toBe('1 分 59 秒');
});
