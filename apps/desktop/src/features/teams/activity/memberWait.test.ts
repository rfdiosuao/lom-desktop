import { expect, it } from 'vitest';
import { memberWait, memberRuntimeLabel } from './memberWait';
import type { Conv } from '@/state/types';
it('TEAM-WAIT-01 pending approval takes priority over running tools and survives idle', () => {
  const pending = { id: 'approve', type: 'approval' as const, status: 'pending' as const, at: 1000, toolName: 'lom_search' };
  const c = { messages: [pending, { id: 'tool', type: 'tool', status: 'running', at: 1100 }] } as Conv;
  expect(memberWait(c, 32000)).toMatchObject({ message: pending, label: '等待授权', tool: 'lom_search', seconds: 31 });
});
it('TEAM-WAIT-01 answered questions do not remain waits', () => {
  const c = { messages: [{ id: 'q', type: 'question', status: 'resolved', at: 1000 }] } as Conv;
  expect(memberWait(c, 2000)).toBeUndefined();
});
it.each(['pending', 'submitting', 'unconfirmed'] as const)('TEAM-WAIT-01 question %s is visible without a running flag', status => {
  const c = { messages: [{ id: 'q', type: 'question', status, at: 1000 }] } as Conv;
  expect(memberWait(c, 2000)?.label).toBe(status === 'unconfirmed' ? '回答结果待核实' : status === 'submitting' ? '正在提交回答' : '等待回答');
});

it('TEAM-WAIT-01 idle without terminal evidence is unknown', () => {
  const c = { messages: [{ id: 'reply', type: 'assistant', at: 1000 }] } as Conv;
  expect(memberRuntimeLabel(c, false)).toBe('运行状态未知');
  expect(memberRuntimeLabel(c, true)).toBe('执行中');
});

it('TEAM-WAIT-01 unconfirmed authorization remains attention without claiming a backend wait', () => {
  const c = { messages: [{ id: 'a', type: 'approval', status: 'unconfirmed', at: 1000 }] } as Conv;
  expect(memberRuntimeLabel(c, true)).toBe('授权结果待核实');
  expect(memberRuntimeLabel(c, false)).toBe('授权结果待核实');
});
it.each(['pending', 'submitting'] as const)('TEAM-WAIT-01 a fresh %s action outranks an older unconfirmed result', status => {
  const current = { id: 'new', type: 'question' as const, status, at: 2000 };
  const c = { messages: [{ id: 'old', type: 'approval', status: 'unconfirmed', at: 1000 }, current] } as Conv;
  expect(memberWait(c)?.message.id).toBe('new');
});
