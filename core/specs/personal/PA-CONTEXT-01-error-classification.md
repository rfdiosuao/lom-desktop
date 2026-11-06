# PA-CONTEXT-01: Oversized provider request errors

## Problem and contract

The typed provider status mapper in `crates/aionui-ai-agent/src/manager/aionrs/error.rs`
currently lets HTTP 413 reach the generic retryable gateway fallback. The text fallback
in `crates/aionui-ai-agent/src/protocol/send_error.rs` also lacks this classification.
Repeating the same oversized request cannot resolve that rejection.

Both entry points must emit `UserLlmProviderContextTooLarge`, ownership
`UserLlmProvider`, `retryable = false`, and resolution `ReduceContext` for HTTP 413.
This includes request-body size limits (for example image payloads), not only token
context-window limits. Technical detail remains available through the existing
error detail handling. Existing runtime summaries already include the HTTP status;
no additional production logging is needed.

## Scope and verification

Regression tests cover typed `ProviderError::Api` with status 413 and generic
upstream text containing explicit API/HTTP/status 413 and its standard reason phrases.
Incidental numbers such as a 413 ms duration must not match. Tests assert
the specific error code, ownership, retry policy, and resolution. Neighboring status
handling is unchanged. The error mapping classifies terminal errors; the embedded policy below enables
the existing compaction engine. No attachment removal or retry algorithm is added here.

Run `cargo test -p aionui-ai-agent`, `cargo clippy -p aionui-ai-agent -- -D warnings`,
and `cargo fmt --all -- --check`. No running application or user data is modified.

## Embedded automatic compaction policy

LOM enables automatic compaction at 75 percent of the resolved context window.
Standalone CLI configuration cannot disable or delay this embedded recovery policy.
The configured context window is preserved; this layer does not guess model limits.
A config-resolution regression supplies disabled compaction and a different threshold,
then verifies the embedded override and unchanged resolved context window.

## Engine integration

The embedded runtime pins the LOM aionrs fork (v0.2.11 plus request-byte and image-projection fixes), retaining the existing patched process crate. Automatic compaction is enabled at 75% of the resolved context window and uses an independent 2 MiB conservative serialized-content budget, even when standalone CLI settings disable it. Original host chat history and assistant memory are preserved. Synchronous request rejection can recover once without restarting tools; repeated/unknown failures remain explicit. No installed application is replaced by this PR.
