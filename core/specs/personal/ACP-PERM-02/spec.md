# ACP-PERM-02: explicit Qoder permission change through idle same-session resume

Scope: an explicit Team member config PUT for backend qoder, option mode, value
yolo, whose currently displayed mode differs. This goes directly through a
reserved idle restart because the real 1.1.78 captures in ACP-PERM-01 show its
in-band yolo transitions failing. No automatic startup migration, extra-vs-snapshot
precedence change, running-task restart, prompt replay, or approval callback bypass.

## Lifecycle and safety

- The Team coordinator's strict restart gate atomically rejects active and queued
  work. Additionally reject a live runtime reporting Running/background work or
  a missing task. Reserve the existing member attach lease. Explicit setters for
  one conversation are serialized, so a mode rebuild waits for earlier user
  config operations instead of terminating their target.
- Carry required_mode_on_resume only in typed, owned build options through the
  existing attach/provisioning/warmup composition path. Override this build's
  mode seed without writing a requested mode into persisted observed state.
  Keep the same backend session anchor. Reject missing anchors.
- The factory restricts this operation to Qoder yolo. Warmup sends no prompt.
  After warmup and before attaching the domain-event persistence consumer, compare
  the original backend anchor and raw mode evidence from this process's
  session/load response. Do not trust config_snapshot alone: it can synthesize
  a mode from preloaded catalogs/desired state. Raw omitted mode/config is failure;
  contradictory raw modes and config current values are failure.
- Record raw load evidence before legacy compatibility code substitutes a
  preloaded currentModeId. Never derive this evidence from that substitute or
  from a catalog supplement, and never persist the evidence as user intent.
- Only a same-session raw yolo response plus yolo readback permits consumer
  attachment, member Ready, and an Observed response. No partial CommandAck is
  upgraded to success. All warmup/query/anchor/mode failures stop the unverified
  replacement and drop its domain-event receiver, preserving the old snapshot
  and backend anchor on these pre-verification failures. Once raw mode/anchor
  verification succeeds and persistence is attached, a later event-loop/runtime
  failure retains the genuinely observed mode; the API reports runtime failure
  rather than success. A real observation is not rolled back into stale state.
  The Team runtime reports failed instead of ready on attach failure.
- Permission initialization uses process-local args from ACP-PERM-01; global
  Qoder settings and wrappers remain untouched. Other explicit backend/mode
  selections continue through their existing config setter.

## Verification

Focused tests exercise the actual Team setter selection/Observed result,
strict busy rejection and mode preservation, active/queued/background rejection,
failed/mismatching attach before Ready, same-session raw mode validation,
owned-only build override, and SQLite persistence isolation for warmup/query/
mode/anchor/missing-raw failures. Success attaches the consumer; failure kills
exactly the replacement and never sends or cancels a prompt.

The ACP-PERM-01 real persisted-load capture proves a default session can be loaded
as yolo using the process argument. A separate controlled read-only MCP tool
probe, if successful, is narrow evidence for that actual call only. It does not
prove every tool class or recover any existing production session.

## Tradeoffs

Ordinary rebuilds retain persisted-mode precedence; this typed override belongs
only to the explicit user operation and does not overwrite a legitimate later
choice merely because conversation.extra still contains an older create seed.
The standalone restart_runtime path cancels active work and rejects Team-owned
conversations, so this implementation uses the Team coordinator reservation
instead. Persistence begins after raw verification, not after every possible
post-start lifecycle event; later runtime failure preserves actual observations
while reporting failure accurately. No global Qoder configuration is rewritten.

Final affected verification completed against the final implementation with debug
information and incremental compilation disabled, while this branch exclusively
owned the shared target: 8 focused explicit-permission tests and the raw-mode
evidence regression passed; ai-agent/conversation/team library suites passed
1036/476/494 tests (2006 total). Clippy for those crates plus App, with
--all-targets and -D warnings, passed. Workspace fmt and diff checks passed.
The final workspace push gate remains separate and is not claimed here.
