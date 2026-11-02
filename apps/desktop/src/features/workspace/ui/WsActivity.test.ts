import { describe, expect, it } from 'vitest';
import { changesOf, planOf } from './WsActivity';

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
});
