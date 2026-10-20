import { describe, expect, it } from 'vitest';
import {
  applyFeedback,
  canPromoteToSkill,
  confidenceFor,
  containsPii,
  containsSecret,
  dedupeKey,
  insightKey,
  insightScore,
  isExpired,
  mergeKnowledge,
  rankForInjection,
  shouldDistill,
  shouldProposeIssue,
  validateCandidate,
  type CandidateInput,
  type EvidenceRef,
  type KnowledgeItem,
  type TaskTrace,
} from './policy';

const NOW = new Date('2026-10-20T00:00:00Z');
const EVIDENCE: EvidenceRef[] = [
  { sessionId: 's1', toolCallId: 't1', outcome: 'success', at: '2026-10-19T00:00:00Z' },
  { sessionId: 's2', toolCallId: 't2', outcome: 'success', at: '2026-10-19T00:05:00Z' },
];

const baseInput = (overrides: Partial<CandidateInput> = {}): CandidateInput => ({
  kind: 'pitfall',
  scope: 'project',
  domain: 'lom.core.lifecycle',
  trigger: '核心进程退出但外壳仍在运行',
  claim: '外壳必须持有内核的监督与重启逻辑',
  boundary: '仅在核心以子进程方式运行时成立',
  verification: '结束核心进程后 5 秒内观察新进程',
  evidence: EVIDENCE,
  ...overrides,
});

function accepted(overrides: Partial<CandidateInput> = {}, now = NOW): KnowledgeItem {
  const result = validateCandidate(baseInput(overrides), now);
  if (!result.ok) throw new Error(`expected accepted candidate, got ${result.code}`);
  return result.item;
}

const trace = (overrides: Partial<TaskTrace> = {}): TaskTrace => ({
  sessionId: 's1',
  domain: 'lom.core.lifecycle',
  goal: '修复内核失联',
  outcome: 'success',
  durationMs: 60_000,
  toolCalls: 3,
  retries: 0,
  userCorrections: 0,
  repeatedAcrossSessions: 0,
  summary: '一次普通成功',
  ...overrides,
});

describe('distillation triggers', () => {
  it('ignores routine successes', () => {
    expect(shouldDistill(trace())).toEqual({ should: false, reasons: [] });
  });

  it('captures failure recovery, corrections, recurrence and expensive verified work', () => {
    expect(shouldDistill(trace({ outcome: 'failure', retries: 2 })).reasons).toContain('failure-recovery');
    expect(shouldDistill(trace({ userCorrections: 1 })).reasons).toContain('user-correction');
    expect(shouldDistill(trace({ repeatedAcrossSessions: 2 })).reasons).toContain('recurring');
    expect(shouldDistill(trace({ durationMs: 11 * 60_000, verification: '手动复测通过' })).reasons).toContain(
      'expensive-success',
    );
  });

  it('treats a negative rating as a signal even without a failure', () => {
    expect(shouldDistill(trace({ explicitRating: 'down' })).should).toBe(true);
  });
});

describe('candidate validation', () => {
  it('accepts a verified item and derives a stable id', () => {
    const item = accepted();
    expect(item.status).toBe('active');
    expect(item.confidence).toBe(0.8);
    expect(item.id).toMatch(/^k_[0-9a-f]{8}_[0-9a-f]{8}$/);
    expect(item.dedupeKey).toBe(dedupeKey(baseInput()));
  });

  it('requires a tool-call evidence reference', () => {
    const result = validateCandidate(
      baseInput({ evidence: [{ sessionId: 's1', outcome: 'success', at: '2026-10-19T00:00:00Z' }] }),
      NOW,
    );
    expect(result).toEqual({ ok: false, code: 'NO_EVIDENCE' });
  });

  it('requires verification, a non-trivial claim and a boundary for playbooks', () => {
    expect(validateCandidate(baseInput({ verification: '  ' }), NOW)).toEqual({ ok: false, code: 'NO_VERIFICATION' });
    expect(validateCandidate(baseInput({ claim: '短结论' }), NOW)).toEqual({ ok: false, code: 'TOO_SHORT' });
    expect(validateCandidate(baseInput({ kind: 'playbook', boundary: '' }), NOW)).toEqual({
      ok: false,
      code: 'NO_BOUNDARY',
    });
  });

  it('rejects secrets instead of persisting them', () => {
    const result = validateCandidate(baseInput({ claim: '使用 sk-demo1234567890abcdef 作为密钥' }), NOW);
    expect(result).toEqual({ ok: false, code: 'SECRET_DETECTED' });
    expect(containsSecret(['-----BEGIN', 'PRIVATE KEY-----'].join(' '))).toBe(true);
  });

  it('requires explicit approval and PII review before public scope', () => {
    expect(validateCandidate(baseInput({ scope: 'public' }), NOW)).toEqual({
      ok: false,
      code: 'PUBLIC_NEEDS_APPROVAL',
    });
    expect(validateCandidate(baseInput({ scope: 'public', explicitRating: 'down' }), NOW)).toEqual({
      ok: false,
      code: 'PUBLIC_NEEDS_APPROVAL',
    });
    expect(
      validateCandidate(baseInput({ scope: 'public', explicitRating: 'up', claim: '联系 ops@example.com 复核后再发布' }), NOW),
    ).toEqual({ ok: false, code: 'PII_REQUIRES_REVIEW' });
    expect(containsPii('ops@example.com')).toBe(true);
    expect(containsPii('13800138000')).toBe(true);
    expect(containsPii('没有联系方式的结论')).toBe(false);
  });

  it('caps a single observation of a decision at 0.6 confidence', () => {
    const one = baseInput({
      kind: 'decision',
      evidence: [{ sessionId: 's1', toolCallId: 't1', outcome: 'success', at: '2026-10-19T00:00:00Z' }],
      explicitRating: 'up',
    });
    expect(confidenceFor(one)).toBe(0.6);
  });

  it('rejects low-confidence candidates instead of guessing', () => {
    const result = validateCandidate(
      baseInput({
        explicitRating: 'down',
        evidence: [{ sessionId: 's1', toolCallId: 't1', outcome: 'failure', at: '2026-10-19T00:00:00Z' }],
      }),
      NOW,
    );
    expect(result).toEqual({ ok: false, code: 'LOW_CONFIDENCE' });
  });
});

describe('dedupe and merge', () => {
  it('normalizes whitespace, punctuation and case for the same scope', () => {
    const first = dedupeKey({ domain: 'Lom.Core', kind: 'pitfall', scope: 'project', trigger: '核心 进程 退出' });
    const second = dedupeKey({ domain: 'lom.core', kind: 'pitfall', scope: 'project', trigger: '核心进程退出！' });
    expect(first).toBe(second);
    expect(first).not.toBe(
      dedupeKey({ domain: 'lom.core', kind: 'pitfall', scope: 'user', trigger: '核心进程退出' }),
    );
  });

  it('keeps insight keys stable so repeated runs do not file duplicate issues', () => {
    expect(insightKey('lom.core', '内核退出后 UI 失联')).toBe(insightKey('LOM.Core ', '内核 退出后 UI 失联！'));
    expect(insightKey('lom.core', '内核退出后 UI 失联')).not.toBe(insightKey('lom.ui', '内核退出后 UI 失联'));
  });

  it('merges matching claims by accumulating independent evidence', () => {
    const existing = accepted();
    const incoming = accepted(
      {
        evidence: [
          ...EVIDENCE,
          { sessionId: 's3', toolCallId: 't3', outcome: 'success', at: '2026-10-20T00:00:00Z' },
        ],
      },
      new Date('2026-10-20T01:00:00Z'),
    );
    const merged = mergeKnowledge(existing, incoming, new Date('2026-10-20T02:00:00Z'));
    expect(merged.status).toBe('merged');
    if (merged.status !== 'merged') throw new Error('expected merge');
    expect(merged.item.evidence).toHaveLength(3);
    expect(merged.item.confidence).toBeGreaterThan(existing.confidence);
  });

  it('surfaces conflicts instead of overwriting', () => {
    const existing = accepted();
    const incoming = accepted({ claim: '外壳只负责渲染，不应监督内核进程' });
    expect(mergeKnowledge(existing, incoming)).toMatchObject({ status: 'conflict' });
  });

  it('refuses to merge unrelated keys', () => {
    const existing = accepted();
    const incoming = accepted({ trigger: '另一个完全不同的触发条件' });
    expect(() => mergeKnowledge(existing, incoming)).toThrow('different dedupe keys');
  });
});

describe('feedback, expiry and promotion', () => {
  it('tracks adoption and lowers confidence on regression', () => {
    const item = { ...accepted(), confidence: 0.45 };
    const adopted = applyFeedback(item, 'adopted', NOW);
    expect(adopted.stats.adoptions).toBe(1);
    expect(adopted.stats.retrievals).toBe(1);
    const regressed = applyFeedback(applyFeedback(item, 'regression', NOW), 'regression', NOW);
    expect(regressed.confidence).toBe(0.25);
    expect(regressed.status).toBe('conflicted');
  });

  it('expires stale items and treats invalid dates as stale', () => {
    expect(isExpired({ ...accepted(), lastVerifiedAt: '2026-01-01T00:00:00Z', ttlDays: 30 }, NOW)).toBe(true);
    expect(isExpired({ ...accepted(), lastVerifiedAt: '2026-10-15T00:00:00Z', ttlDays: 30 }, NOW)).toBe(false);
    expect(isExpired({ ...accepted(), lastVerifiedAt: 'not-a-date' }, NOW)).toBe(true);
  });

  it('promotes only proven, adopted and stable items', () => {
    const item = accepted();
    const later = new Date('2026-10-30T00:00:00Z');
    expect(canPromoteToSkill({ ...item, stats: { retrievals: 10, adoptions: 3, regressions: 0 } }, later)).toBe(true);
    expect(canPromoteToSkill({ ...item, stats: { retrievals: 10, adoptions: 2, regressions: 0 } }, later)).toBe(false);
    expect(canPromoteToSkill({ ...item, stats: { retrievals: 10, adoptions: 3, regressions: 1 } }, later)).toBe(false);
    expect(canPromoteToSkill({ ...item, status: 'candidate', stats: { retrievals: 10, adoptions: 3, regressions: 0 } }, later)).toBe(false);
  });

  it('scores an insight and gates low-value proposals', () => {
    expect(insightScore({ impact: 5, frequency: 5, verifiability: 5, effort: 1 })).toBe(1);
    expect(insightScore({ impact: 1, frequency: 1, verifiability: 1, effort: 5 })).toBe(0.002);
    expect(shouldProposeIssue({ impact: 5, frequency: 4, verifiability: 5, effort: 2 })).toBe(true);
    expect(shouldProposeIssue({ impact: 2, frequency: 2, verifiability: 2, effort: 5 })).toBe(false);
  });
});

describe('injection ranking', () => {
  it('only exposes knowledge visible to the caller scope', () => {
    const project = accepted({ scope: 'project' });
    const user = accepted({ scope: 'user' });
    const team = accepted({ scope: 'team' });
    const shared = { ...accepted({ scope: 'public', explicitRating: 'up' }), status: 'active' as const };
    const items = [project, user, team, shared];

    expect(rankForInjection(items, { scope: 'project', context: '核心进程退出', now: NOW }).map(item => item.scope).sort()).toEqual([
      'project',
      'public',
      'team',
      'user',
    ]);
    expect(rankForInjection(items, { scope: 'user', context: '核心进程退出', now: NOW }).map(item => item.scope).sort()).toEqual([
      'public',
      'team',
      'user',
    ]);
    expect(rankForInjection(items, { scope: 'public', context: '核心进程退出', now: NOW }).map(item => item.scope)).toEqual([
      'public',
    ]);
  });

  it('drops candidates and respects the token budget', () => {
    const active = accepted();
    const candidate = { ...accepted({ scope: 'public', explicitRating: 'up' }), status: 'candidate' as const };
    expect(rankForInjection([active, candidate], { scope: 'project', context: '核心', now: NOW })).toHaveLength(1);
    expect(rankForInjection([active], { scope: 'project', context: '核心', now: NOW, tokenBudget: 1 })).toEqual([]);
    expect(rankForInjection([active], { scope: 'project', context: '核心', now: NOW, limit: 0 })).toEqual([]);
  });

  it('ranks fresh, relevant knowledge above expired knowledge', () => {
    const fresh = accepted({ trigger: '核心进程退出时监督重启' });
    const stale = accepted({
      trigger: '核心进程退出时监督重启（旧）',
      evidence: [{ sessionId: 's9', toolCallId: 't9', outcome: 'success', at: '2026-01-01T00:00:00Z' }],
    });
    const expired = { ...stale, lastVerifiedAt: '2026-01-01T00:00:00Z', ttlDays: 30 };
    const ranked = rankForInjection([expired, fresh], { scope: 'project', context: '核心进程退出', now: NOW, limit: 2 });
    expect(ranked.map(item => item.id)).toEqual([fresh.id, expired.id]);
  });
});
