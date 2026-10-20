/**
 * Pure knowledge policy for desktop-local agents.
 *
 * This module deliberately contains no storage, network or model calls. The
 * private runtime extracts candidates, persists them and injects the ranked
 * result; this file only decides what is worth keeping, how to merge it and
 * when it may be promoted into a skill.
 */

export type KnowledgeKind = 'fact' | 'decision' | 'playbook' | 'pitfall';
export type KnowledgeScope = 'project' | 'user' | 'team' | 'public';
export type KnowledgeStatus = 'candidate' | 'active' | 'conflicted' | 'expired' | 'rejected';

export interface EvidenceRef {
  sessionId: string;
  toolCallId?: string;
  outcome: 'success' | 'failure' | 'correction';
  at: string;
}

export interface KnowledgeStats {
  retrievals: number;
  adoptions: number;
  regressions: number;
}

export interface KnowledgeItem {
  id: string;
  kind: KnowledgeKind;
  scope: KnowledgeScope;
  domain: string;
  trigger: string;
  claim: string;
  boundary: string;
  verification: string;
  evidence: EvidenceRef[];
  confidence: number;
  dedupeKey: string;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string;
  ttlDays: number;
  status: KnowledgeStatus;
  supersedes?: string;
  tags: string[];
  stats: KnowledgeStats;
}

export interface TaskTrace {
  sessionId: string;
  domain: string;
  goal: string;
  outcome: 'success' | 'failure' | 'partial';
  durationMs: number;
  toolCalls: number;
  retries: number;
  userCorrections: number;
  repeatedAcrossSessions: number;
  explicitRating?: 'up' | 'down';
  verification?: string;
  toolCallIds?: string[];
  summary: string;
}

export interface CandidateInput {
  kind: KnowledgeKind;
  scope: KnowledgeScope;
  domain: string;
  trigger: string;
  claim: string;
  boundary: string;
  verification: string;
  evidence: EvidenceRef[];
  explicitRating?: 'up' | 'down';
  ttlDays?: number;
  tags?: string[];
  supersedes?: string;
}

export type RejectionCode =
  | 'NO_EVIDENCE'
  | 'NO_VERIFICATION'
  | 'TOO_SHORT'
  | 'NO_BOUNDARY'
  | 'SECRET_DETECTED'
  | 'PII_REQUIRES_REVIEW'
  | 'LOW_CONFIDENCE'
  | 'PUBLIC_NEEDS_APPROVAL';

export type ValidationResult =
  | { ok: true; item: KnowledgeItem }
  | { ok: false; code: RejectionCode };

export interface InsightSignal {
  /** How many users or workflows are blocked. 1..5 */
  impact: number;
  /** How often the same root cause appears. 1..5 */
  frequency: number;
  /** How cheaply a fix can be verified. 1..5 */
  verifiability: number;
  /** Estimated change cost. 1..5 */
  effort: number;
}

export interface PromotionPolicy {
  minConfidence: number;
  minAdoptions: number;
  maxRegressions: number;
  minAgeDays: number;
}

export const DEFAULT_PROMOTION: PromotionPolicy = {
  minConfidence: 0.75,
  minAdoptions: 3,
  maxRegressions: 0,
  minAgeDays: 7,
};

const EXPENSIVE_TASK_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i,
];
const PII_PATTERNS = [/\b[\w.+-]+@[\w-]+\.[\w.]+\b/, /\b1[3-9]\d{9}\b/];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value * 1000) / 1000;
const normalize = (value: string) =>
  value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Deterministic key for the same lesson: scope + domain + kind + normalized trigger. */
export function dedupeKey(input: Pick<CandidateInput, 'domain' | 'kind' | 'scope' | 'trigger'>): string {
  return stableHash(
    [input.scope, input.domain.trim().toLowerCase(), input.kind, normalize(input.trigger)].join('|'),
  );
}

/** Stable key for an external issue/insight, so repeated runs cannot spam. */
export function insightKey(component: string, symptom: string): string {
  return stableHash([component.trim().toLowerCase(), normalize(symptom)].join('|'));
}

export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some(pattern => pattern.test(text));
}

export function containsPii(text: string): boolean {
  return PII_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * A trace is only worth distilling when it carries a learning signal. Routine
 * successes are ignored on purpose: saving everything is how a knowledge base
 * turns into documentation debt.
 */
export function shouldDistill(trace: TaskTrace): { should: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (trace.outcome === 'failure' && trace.retries > 0) reasons.push('failure-recovery');
  if (trace.userCorrections > 0) reasons.push('user-correction');
  if (trace.repeatedAcrossSessions >= 2) reasons.push('recurring');
  if (trace.explicitRating === 'up' && trace.verification) reasons.push('verified-success');
  if (trace.explicitRating === 'down') reasons.push('negative-feedback');
  if (trace.outcome === 'success' && trace.durationMs >= EXPENSIVE_TASK_MS && trace.verification)
    reasons.push('expensive-success');
  return { should: reasons.length > 0, reasons };
}

/**
 * Confidence starts low and only grows with independent evidence. A single
 * observation may describe a fact, but never a reusable decision or playbook.
 */
export function confidenceFor(input: CandidateInput): number {
  const sessions = new Set(input.evidence.map(evidence => evidence.sessionId)).size;
  let score = 0.4;
  score += Math.min(0.3, sessions * 0.1);
  if (input.evidence.some(evidence => evidence.outcome === 'success')) score += 0.1;
  if (input.explicitRating === 'up') score += 0.1;
  if (input.explicitRating === 'down') score -= 0.2;
  if (input.verification.trim()) score += 0.1;
  if (sessions <= 1 && (input.kind === 'decision' || input.kind === 'playbook')) {
    score = Math.min(score, 0.6);
  }
  return round(clamp(score, 0, 0.95));
}

export function validateCandidate(input: CandidateInput, now: Date = new Date()): ValidationResult {
  const text = [input.trigger, input.claim, input.boundary, input.verification].join('\n');
  if (!input.evidence.length || !input.evidence.some(evidence => evidence.toolCallId)) {
    return { ok: false, code: 'NO_EVIDENCE' };
  }
  if (!input.verification.trim()) return { ok: false, code: 'NO_VERIFICATION' };
  if (input.claim.trim().length < 12) return { ok: false, code: 'TOO_SHORT' };
  if ((input.kind === 'pitfall' || input.kind === 'playbook') && !input.boundary.trim()) {
    return { ok: false, code: 'NO_BOUNDARY' };
  }
  if (containsSecret(text)) return { ok: false, code: 'SECRET_DETECTED' };
  if (input.scope === 'public' && containsPii(text)) {
    return { ok: false, code: 'PII_REQUIRES_REVIEW' };
  }
  if (input.scope === 'public' && input.explicitRating !== 'up') {
    return { ok: false, code: 'PUBLIC_NEEDS_APPROVAL' };
  }

  const confidence = confidenceFor(input);
  if (confidence < 0.5) return { ok: false, code: 'LOW_CONFIDENCE' };

  const timestamp = now.toISOString();
  const key = dedupeKey(input);
  return {
    ok: true,
    item: {
      id: `k_${key}_${stableHash(input.claim)}`,
      kind: input.kind,
      scope: input.scope,
      domain: input.domain,
      trigger: input.trigger,
      claim: input.claim,
      boundary: input.boundary,
      verification: input.verification,
      evidence: input.evidence.map(evidence => ({ ...evidence })),
      confidence,
      dedupeKey: key,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastVerifiedAt: timestamp,
      ttlDays: input.ttlDays ?? (input.kind === 'fact' ? 365 : 90),
      status: input.scope === 'public' ? 'candidate' : 'active',
      supersedes: input.supersedes,
      tags: [...new Set((input.tags ?? []).map(tag => tag.trim()).filter(Boolean))],
      stats: { retrievals: 0, adoptions: 0, regressions: 0 },
    },
  };
}

export type MergeResult =
  | { status: 'merged'; item: KnowledgeItem }
  | { status: 'conflict'; existing: KnowledgeItem; incoming: KnowledgeItem };

/**
 * Same key and same claim: grow evidence. Same key but a different claim is a
 * conflict, never a silent overwrite.
 */
export function mergeKnowledge(existing: KnowledgeItem, incoming: KnowledgeItem, now: Date = new Date()): MergeResult {
  if (existing.dedupeKey !== incoming.dedupeKey) {
    throw new Error('cannot merge different dedupe keys');
  }
  if (normalize(existing.claim) !== normalize(incoming.claim)) {
    return { status: 'conflict', existing, incoming };
  }
  const evidence = new Map<string, EvidenceRef>();
  for (const ref of [...existing.evidence, ...incoming.evidence]) {
    evidence.set(`${ref.sessionId}:${ref.toolCallId ?? ''}:${ref.outcome}`, ref);
  }
  const confidence = round(
    clamp(1 - (1 - existing.confidence) * (1 - incoming.confidence * 0.6), 0, 0.95),
  );
  return {
    status: 'merged',
    item: {
      ...existing,
      evidence: [...evidence.values()],
      confidence,
      updatedAt: now.toISOString(),
      lastVerifiedAt: now.toISOString(),
      stats: {
        retrievals: existing.stats.retrievals + incoming.stats.retrievals,
        adoptions: existing.stats.adoptions + incoming.stats.adoptions,
        regressions: existing.stats.regressions + incoming.stats.regressions,
      },
    },
  };
}

export function applyFeedback(
  item: KnowledgeItem,
  feedback: 'adopted' | 'ignored' | 'regression',
  now: Date = new Date(),
): KnowledgeItem {
  const stats = { ...item.stats, retrievals: item.stats.retrievals + 1 };
  if (feedback === 'adopted') stats.adoptions += 1;
  if (feedback === 'regression') stats.regressions += 1;
  const confidence =
    feedback === 'regression' ? round(clamp(item.confidence - 0.1, 0, 0.95)) : item.confidence;
  return {
    ...item,
    stats,
    confidence,
    updatedAt: now.toISOString(),
    status: confidence < 0.4 ? 'conflicted' : item.status,
  };
}

export function isExpired(item: KnowledgeItem, now: Date = new Date()): boolean {
  const verified = Date.parse(item.lastVerifiedAt);
  if (!Number.isFinite(verified)) return true;
  return now.getTime() - verified > item.ttlDays * DAY_MS;
}

/**
 * Value of turning a repeated insight into an external issue/PR. This is the
 * gate that keeps the pipeline from spamming maintainers.
 */
export function insightScore(signal: InsightSignal): number {
  const impact = clamp(signal.impact, 1, 5);
  const frequency = clamp(signal.frequency, 1, 5);
  const verifiability = clamp(signal.verifiability, 1, 5);
  const effort = clamp(signal.effort, 1, 5);
  return round((impact * frequency * verifiability) / (125 * effort));
}

export function shouldProposeIssue(signal: InsightSignal, threshold = 0.35): boolean {
  return insightScore(signal) >= threshold;
}

export function canPromoteToSkill(
  item: KnowledgeItem,
  now: Date = new Date(),
  policy: PromotionPolicy = DEFAULT_PROMOTION,
): boolean {
  if (item.status !== 'active') return false;
  if (item.confidence < policy.minConfidence) return false;
  if (item.stats.adoptions < policy.minAdoptions) return false;
  if (item.stats.regressions > policy.maxRegressions) return false;
  const created = Date.parse(item.createdAt);
  return Number.isFinite(created) && (now.getTime() - created) / DAY_MS >= policy.minAgeDays;
}

export interface InjectionOptions {
  scope: KnowledgeScope;
  context: string;
  limit?: number;
  tokenBudget?: number;
  now?: Date;
}

function tokenSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

function overlap(context: Set<string>, item: Set<string>): number {
  if (!context.size) return 0.5;
  let hits = 0;
  for (const token of context) if (item.has(token)) hits += 1;
  return hits / context.size;
}

function estimateTokens(text: string): number {
  let tokens = 0;
  for (const character of text) {
    tokens += /[\u3400-\u9fff\uf900-\ufaff]/.test(character) ? 1 : 0.25;
  }
  return Math.ceil(tokens);
}

/**
 * Rank only active, in-scope items. The caller injects the returned short list;
 * the full item stays behind a tool call to keep context small.
 */
export function rankForInjection(items: KnowledgeItem[], options: InjectionOptions): KnowledgeItem[] {
  const order: KnowledgeScope[] = ['project', 'user', 'team', 'public'];
  // `scope` is the caller's context: a project may read project/user/team/public
  // knowledge, while a public caller may only read public knowledge.
  const allowed = new Set(order.slice(order.indexOf(options.scope)));
  const context = tokenSet(options.context);
  const now = options.now ?? new Date();

  const scored = items
    .filter(item => item.status === 'active' && allowed.has(item.scope))
    .map(item => {
      const relevance = overlap(context, tokenSet(`${item.trigger} ${item.claim} ${item.tags.join(' ')}`));
      const ageDays = Math.max(0, (now.getTime() - Date.parse(item.lastVerifiedAt)) / DAY_MS);
      const recency = Number.isFinite(ageDays) ? Math.exp(-ageDays / 30) : 0;
      const usage =
        item.stats.retrievals === 0
          ? 0
          : Math.log1p(item.stats.adoptions) / Math.log1p(item.stats.retrievals);
      const freshness = isExpired(item, now) ? 0.2 : 1;
      const score = (0.45 * relevance + 0.25 * item.confidence + 0.15 * recency + 0.15 * usage) * freshness;
      return { item, score };
    })
    .filter(entry => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id));

  const limit = options.limit ?? 5;
  const budget = options.tokenBudget ?? 1200;
  const selected: KnowledgeItem[] = [];
  let used = 0;
  for (const { item } of scored) {
    const cost = estimateTokens(`${item.trigger}${item.claim}`);
    if (selected.length >= limit || used + cost > budget) break;
    selected.push(item);
    used += cost;
  }
  return selected;
}
