import { describe, it, expect } from 'vitest';
import { MAX_BYTES, textDocument } from './documents';
describe('local document guard', () => {
  it('keeps UTF-8 contents and rejects oversized input', () => {
    expect(textDocument('说明.md', '你好').content).toBe('你好');
    expect(() => textDocument('large.md', 'a'.repeat(MAX_BYTES + 1))).toThrow();
  });
});
