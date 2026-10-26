# Lom patches on top of upstream AionCore

This source tree derives from [iOfficeAI/AionCore](https://github.com/iOfficeAI/AionCore)
(Apache-2.0), with Lom desktop core patches.

Rules:

- Lom-owned code lives in new `lom-*` crates. Edits to upstream `aionui-*` crates are kept to a
  minimum and every one is listed below, so upstream merges stay predictable.
- `upstream` remote = iOfficeAI/AionCore (push disabled). Merge upstream every two weeks:
  `git fetch upstream && git merge upstream/main`, then re-run `cargo test --workspace`.
- Each entry states why the patch exists and whether it could be offered upstream.

| ID | Upstream files touched | Lom crate | Why | Upstreamable |
|----|------------------------|-----------|-----|--------------|
| P1 | `Cargo.toml`, `crates/aionui-app/Cargo.toml`, `crates/aionui-app/src/router/routes.rs` (5 lines) | `lom-launch-guard` | `--local` disables auth and allows any CORS origin, so any web page can drive agent tools on 127.0.0.1. When the desktop shell sets `LOM_LAUNCH_TOKEN`, require it (`X-Lom-Token` header, or `token` query for `/ws` and `/api/fs/stream`) and restrict CORS to Tauri origins plus `LOM_ALLOWED_ORIGINS`; WebSocket handshakes from an unregistered browser `Origin` are rejected even with a valid token. Without the env var behavior is unchanged. | Yes (generic hardening) |
| P2 | `crates/aionui-system/src/provider.rs` (+20 lines), `crates/aionui-system/tests/provider_routes.rs` | — | The desktop owns a built-in provider named `Lom 云端` (points-backed gateway token, S04-01). Renaming or deleting it from any client would orphan the user's points access, so update/delete reject it with `provider.builtin_locked`; sign-out disables it and clears the key instead. | No (Lom-specific) |
| P3 | `Cargo.toml` (`[patch]` for `aion-process`), `vendor/aion-process` (upstream aionrs v0.2.11 + fix, see its `LOM-PATCH.md`) | — | Cancelling a turn killed the parent shell but left child processes running (a delayed file write still happened after Stop). Commands now run in their own process group and the whole group is terminated on cancel (Unix); normal completion is unchanged. | Yes (bug fix) |
| P4 | `crates/aionui-common/src/{lib.rs,upload_root.rs}` (new helper), one-line call-site swaps in `aionui-conversation/src/service.rs`, `aionui-team/src/service.rs`, `aionui-office/src/routes.rs` (3), `aionui-file/src/{routes.rs,service.rs}` | — | The managed upload dir was hard-coded as `<tmp>/aionui` in seven places, and that path is shown to the agent with every attached file, so the Lom agent kept seeing another product's name. All sites now call `aionui_common::upload_root()`; `LOM_TEMP_NAMESPACE` (validated `[a-z0-9-]{1,32}`) renames it, unset keeps `aionui`. The Lom shell sets `lom`. | Yes (configurable temp namespace) |

## P5 live embedded permission mode (2026-10-16)

`crates/aionui-ai-agent/src/manager/aionrs/agent.rs` disables the engine's static
`auto_approve` and tool-name allow-list bypasses in the embedded configuration.
The live `ToolApprovalManager` owns approval decisions. Previously, starting in
yolo mode permanently bypassed approval even after changing to default mode.
Standalone `.aionrs.toml` cannot override this host policy. This is an upstreamable
bug fix; unit coverage is in `agent_test.rs` and a real ExecCommand integration
probe is in the Lom repo at `tools/tests/settings-permissions-core.py`.
Existing approval events provide diagnostics; no secret or command logging added.

## P1 cron helper compatibility (2026-10-15)

`crates/aionui-app/src/router/routes.rs` supplies the existing runtime-token verifier to
`lom-launch-guard`. Only the current-conversation cron list/create/update routes accept this
alternative credential. It must be a valid ConversationHelper token bound to the supplied user
and conversation; the cron domain still checks ownership and an active turn. The desktop launch
secret is not exposed to helper commands. Other desktop APIs still require the launch token.

Verified CLI contract: `crates/aionui-app/src/commands/cmd_config.rs` (`run_cron_current`,
`request_json`). Live integration fixture: Lom `tools/dev/verify-cron-helper.py`, which runs the
actual Agent ExecCommand tool and bundled CLI against an isolated guarded core; then verifies
persistence, a manual run, an automatic timer run, pause and deletion. AI responses are a local
deterministic HTTP fixture; this is not a test of a remote model's instruction-following ability.
Existing guard rejection logs and cron lifecycle events provide diagnostics; no credentials or
message bodies are added to logs.

## P6 tool image output preservation (D11, 2026-10-16)

`crates/aionui-ai-agent/src/session_agent.rs` previously discarded normalized
ToolResultContent::FilePath at the final stream translation. Image file paths now
travel in a versioned JSON string inside the existing output field, together with
text; the desktop extracts the image cards in live events and history. Non-image
text remains unchanged. Inline image bytes remain excluded. The existing saved
message output and explicit image loading errors are sufficient diagnostics; no
payload logging added. D11 regression tests exercise path preservation.
