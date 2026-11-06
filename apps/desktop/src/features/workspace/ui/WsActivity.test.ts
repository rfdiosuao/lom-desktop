import { describe, expect, it } from 'vitest';
import { changesOf, planOf, turnChangesOf } from './WsActivity';

describe('workspace plan and changes', () => {
  it('uses the latest plan message', () => {
    const old = [{ text: 'a', done: true }], latest = [{ text: 'b', done: false }];
    expect(planOf([{ type: 'plan', items: old }, { type: 'assistant' }, { type: 'plan', items: latest }])).toBe(latest);
    expect(planOf([{ type: 'assistant' }])).toEqual([]);
  });
  it('merges changes of the same file across messages', () => {
    const list = changesOf([
      { type: 'files', changes: [{ path: 'a.ts', add: 1, del: 0 }, { path: 'b.ts', add: 2, del: 1 }] },
      { type: 'user' },
      { type: 'files', changes: [{ path: 'a.ts', add: 3, del: 2 }] },
    ]);
    expect(list).toEqual([{ path: 'a.ts', add: 4, del: 2 }, { path: 'b.ts', add: 2, del: 1 }]);
  });
  it('WS-CHANGES-01 #402 changes only count the latest turn, not the whole conversation', () => {
    const list = turnChangesOf([
      { type: 'user' },
      { type: 'files', changes: [{ path: 'old.ts', add: 9, del: 0 }, { path: 'a.ts', add: 1, del: 0 }] },
      { type: 'assistant' },
      { type: 'user' },
      { type: 'files', changes: [{ path: 'a.ts', add: 3, del: 2 }] },
      { type: 'files', changes: [{ path: 'a.ts', add: 1, del: 1 }] },
    ]);
    expect(list).toEqual([{ path: 'a.ts', add: 4, del: 3 }]);
  });
  it('WS-CHANGES-01 #402 a new turn without edits shows no changes', () => {
    expect(turnChangesOf([{ type: 'user' }, { type: 'files', changes: [{ path: 'a.ts', add: 1, del: 0 }] }, { type: 'assistant' }, { type: 'user' }])).toEqual([]);
  });
  it('WS-CHANGES-01 #402 a conversation without a user message counts every change', () => {
    expect(turnChangesOf([{ type: 'files', changes: [{ path: 'a.ts', add: 1, del: 0 }] }])).toEqual([{ path: 'a.ts', add: 1, del: 0 }]);
  });
});
