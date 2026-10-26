# PA-EVOLVE-01 — Personal-only evolution

Status: implementation in progress, not wired into daily Personal Agent turns.

Authority: `PA-architecture-v2.md` sections 8–9. Both user corrections and assistant reflections automatically apply. A correction overrides an earlier lesson; a reflection cannot supersede a correction. Changes to confirmation, authorization, or credentials are rejected rather than sent for approval. This replaces the earlier proposed mandatory probe-before-adoption policy.

Reference: https://github.com/google-research/harness2 (`harness2/core/library.py`, `selection.py`, `recursion.py`, `ledger.py`, read 2026-10-23). The transferable design is cue/lesson/evidence plus retained versions and subsequent task learning. Lom intentionally does not copy benchmark rollouts or treat model self-assessment as proof of success. No upstream code is copied.

## Implemented first slice

Pure projections additionally generate bounded JSON context and replace only a uniquely marked managed document section, preserving user-authored text. Neither projection writes files or exposes an HTTP endpoint.

A Rust workspace crate provides an append-only revision ledger, automatic application, correction priority, a corrected-history marker, idempotent repeat processing, scope partitioning, optimistic concurrency protection, and rollback as a new revision. Failed persistence does not update the in-memory adopted state. No credentials, CLI configuration, or protected persona files are written by this crate.

## Integration work still required

- Bind scope to verified cloud-account ownership and a stored Personal Agent identity, not caller-provided fields.
- Extract lessons from real completed turns and explicit correction messages using the Lom account model.
- Enforce trusted classification of security-sensitive proposals: the current typed Effect is an internal contract, not an authorization boundary; never expose raw learn input as a public API.
- Materialize managed sections of USER/TOOLS/AGENTS/SOUL without replacing original content; synchronize document versions and journal.
- Inject adopted context into Personal Agent only and notify corrections on their source channel.
- Add authenticated history/rollback routes and desktop controls.
- Record blocked lessons in the actual runtime audit stream without logging prompts or credentials.
- Crash recovery for truncated journal writes and stale lock files needs explicit reconciliation; currently fails closed.

## Validation

Behavior tests cover automatic correction and reflection, correction priority, corrected marker, idempotency, restart, rollback preserving history, distinct scopes, stale writers, and blocked typed security changes. This does not establish live model extraction, document publication, permission-classification robustness, or IM delivery.

No production hooks are installed until the integration boundaries above are complete. Never describe this crate alone as a delivered self-evolving Personal Agent.

## Document publication follow-up

The internal `publish_document` method now writes only the managed section of a fixed USER/TOOLS/AGENTS/SOUL filename. It checks the caller's original-content snapshot, rejects symlink targets/directories and occupied staging files, preserves existing permissions, fsyncs a staging file and atomically renames it. Existing notes remain intact. A crashed staging file deliberately blocks future publication until reconciled. Publication is per-document, not a transaction across four documents and the lesson journal; retries regenerate from the authoritative ledger.

The caller must supply an authorized, assistant-private directory with no untrusted concurrent filesystem writers. This helper is not an ownership authorization boundary; it is not yet exposed as an API or called by production turns. External editors can race the snapshot check and rename; a future shared document-write service must coordinate those writers. Failure after rename but before directory sync may have published the file; read/reconcile before retrying.

Lesson retry identity now compares every field, so changes to cue, target or effect are no longer silently discarded when content/evidence remain unchanged.
