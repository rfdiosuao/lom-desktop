import { beforeEach, expect, it } from 'vitest';
import { S } from '@/state/store';
import type { Conv, Msg } from '@/state/types';
import { TEAM_SEND_DUP_WINDOW_MS, duplicateAgeMinutes, recentSend, rememberSend } from './teamSendDedup';

let conv: Conv, turn: Msg;
beforeEach(() => {
  turn = { id: 'u1', type: 'user', at: 1_500, text: '开工' };
  conv = { id: 's1', owner: 'pc', title: 'c', updated: 0, messages: [turn] } as Conv;
  S.convs = [conv]; S.running = {};
});

it('TEAM-ORCH-03 a send whose turn has not ended is found again for the same team, member and text', () => {
  rememberSend('t1', 'm1', '开工', 's1', 1_000);
  expect(recentSend('t1', 'm1', '  开工 ', 2_000)).toEqual({ at: 1_000, sessionId: 's1' });
});

it('TEAM-ORCH-03 once the earlier turn has a terminal outcome the same text may be sent again', () => {
  rememberSend('t1', 'm1', '继续', 's1', 1_000);
  turn.turnOutcome = 'completed';
  expect(recentSend('t1', 'm1', '继续', 2_000)).toBeUndefined();
});

it('TEAM-ORCH-03 a running member is never treated as finished even if an outcome is recorded', () => {
  rememberSend('t1', 'm1', '继续', 's1', 1_000);
  turn.turnOutcome = 'completed'; S.running[conv.id] = true;
  expect(recentSend('t1', 'm1', '继续', 2_000)).toBeDefined();
});

it('TEAM-ORCH-03 a phone member counts as finished only from its own terminal run status', () => {
  const phone = { id: 'p1', owner: 'dev', title: 'p', updated: 0, messages: [], phoneSession: 'x', phoneRunStatus: 'accepted' } as unknown as Conv;
  S.convs = [phone];
  rememberSend('t1', 'm9', '拍照', 'p1', 1_000);
  expect(recentSend('t1', 'm9', '拍照', 2_000)).toBeDefined();
  phone.phoneRunStatus = 'completed';
  expect(recentSend('t1', 'm9', '拍照', 2_000)).toBeUndefined();
});

it('TEAM-ORCH-03 an unobservable conversation is treated as still in flight until the window passes', () => {
  rememberSend('t1', 'm1', '开工', 'gone', 1_000);
  expect(recentSend('t1', 'm1', '开工', 2_000)).toBeDefined();
  expect(recentSend('t1', 'm1', '开工', 1_000 + TEAM_SEND_DUP_WINDOW_MS)).toBeUndefined();
});

it('TEAM-ORCH-03 other text, member or team is never treated as a duplicate', () => {
  rememberSend('t1', 'm1', '开工', 's1', 1_000);
  expect(recentSend('t1', 'm1', '收工', 2_000)).toBeUndefined();
  expect(recentSend('t1', 'm2', '开工', 2_000)).toBeUndefined();
  expect(recentSend('t2', 'm1', '开工', 2_000)).toBeUndefined();
});

it('TEAM-ORCH-03 memory stays bounded and a refreshed record is evicted last', () => {
  rememberSend('t', 'm', 'keep', 's1', 10_000);
  for (let i = 0; i < 63; i++) rememberSend('t', 'm', `text-${i}`, 's1', 10_001 + i);
  rememberSend('t', 'm', 'keep', 's1', 10_100); // 刷新：不能还排在最旧的位置
  for (let i = 63; i < 70; i++) rememberSend('t', 'm', `text-${i}`, 's1', 10_200 + i);
  expect(recentSend('t', 'm', 'keep', 10_300)).toBeDefined();
  expect(recentSend('t', 'm', 'text-0', 10_300)).toBeUndefined();
});

it('TEAM-ORCH-03 reports how long ago the first delivery was', () => {
  expect(duplicateAgeMinutes({ at: 0 }, 3 * 60_000 + 5_000)).toBe(3);
});
