# ACP-PERM-01: Qoder process-local permission initialization

## Problem and captured contract

The installed official qodercli 1.1.78 advertises the native ACP mode `yolo` but
fails to enter it from a default-mode process through either session/set_mode or
session/set_config_option. Keep that advertised ACP id; the working process
startup enum is `--permission-mode bypass_permissions`.

For the Qoder backend only, when the existing startup-mode resolver selects yolo,
append this documented process-local argument. Other modes/backends retain their
current launch behavior. Persisted mode retains its existing precedence over the
create-time session_mode; ACP-PERM-02 separately handles explicit idle changes.
Never automatically answer permission callbacks or write global allow rules.

## Real CLI evidence

All fixture paths below are under `protocols/samples/qoder-cli/1.1.78/`.

- `mode-probe.jsonl`: bare --acp; session/new reports default. set_mode(yolo),
  set_mode(bypassPermissions), and set_config_option(mode,yolo) return -32603
  `unknown permission_mode: yolo`. set_mode(bypass_permissions) returns -32602
  because that CLI startup enum is not an advertised ACP mode id.
- `startup-mode-probe.jsonl`: with --permission-mode bypass_permissions --acp,
  session/new reports yolo, set_mode(yolo) succeeds, and set_config_option returns
  mode currentValue=yolo. These first two probes send no model prompt.
- `load-mode-probe.jsonl`: a no-prompt session created in one process could not
  be loaded by a second process (INVALID_SESSION_IDENTIFIER). This does not prove
  resume behavior; the next probe supplies the missing persisted-session case.
- `persisted-load-mode-probe.jsonl`: a bare process creates a default session;
  one prompt, `Output exactly OK. Do not use tools.`, returns OK/end_turn without
  tool or permission events. A second process, started with the bypass argument,
  loads that same persisted session and reports both currentModeId=yolo and mode
  currentValue=yolo. The second process sends no prompt.
- `duplicate-startup-mode-probe.jsonl`: initialize/new probes confirm both
  preceding `--permission-mode default` and `--permission-mode=default` forms
  accept the appended bypass argument and report yolo. Captured layouts include
  the actual append-after-ACP order:
  `--acp --permission-mode default --permission-mode bypass_permissions` and
  `--permission-mode=default --acp --permission-mode bypass_permissions`.
  These probes send no prompt; no wrapper normalization is needed for these forms.
- `readonly-tool-mode-probe.jsonl`: one controlled model turn with the bypass
  argument invokes a local MCP server's fixed-value readonly_probe. The CLI emits
  actual tool_call and pending/in_progress/completed updates, then end_turn, with
  zero session/request_permission requests. An independent local server audit
  records exactly one tools/call for readonly_probe. That tool returns the fixed
  LOM_PERMISSION_PROBE_OK token without reading files, running commands, writing,
  or accessing the network. No other tool call was observed.

Session/message identifiers and workspace paths are sanitized. Unrelated model
catalogs, available-command notifications, and model thought chunks are omitted.
Raw captures, scripts, and the local MCP audit remain private in the recovery
workspace. No probe changed global Qoder settings/wrappers, answered an approval,
or touched a production backend session. Only the persisted and read-only MCP
probes invoked a model, once each.

## Source trace and observability

`factory/acp_launch_policy.rs` previously added only Codex-specific runtime args.
`manager/acp/agent_session_flow.rs` already applies session/new mode/config data
and calls reconcile. `manager/acp/agent_reconcile.rs` logs and skips ordinary
set failures, which explains why the captured CLI transition failure can leave
the process enforcing its initial mode. The startup patch logs a non-sensitive
process-argument request, not an unverified claim that permission mode is active.

The RED launch-policy regression failed before implementation (actual [--acp]
versus the required appended arguments). Focused launch-policy tests, 1032
library tests and 40 integration tests passed after implementation, with 12
ignored tests; affected clippy -D warnings, fmt and diff checks passed. Full
workspace integration remains the final push gate's responsibility.

## Limits

The local MCP capture proves that one controlled tool invocation completed
without requesting permission. It does not prove every tool class or recover
an existing production session. Existing snapshot precedence can still choose a
stored default over an older create-time yolo seed. This startup fix does not
claim that every old session is repaired; explicit idle same-session mode changes
are the separate ACP-PERM-02 lifecycle change.
