//! Two-step probe for custom ACP agents.
//!
//! Step 1: `which`/`where` — resolve the first token of `command` on
//!         `$PATH`. Bounded by `execFileSync`-equivalent 5 s timeout.
//! Step 2: Spawn the CLI via `CliAgentProcess::spawn_for_sdk`, connect
//!         an `AcpProtocol` (which owns the ACP `initialize` handshake
//!         with a built-in 30 s timeout), then shut down cleanly.
//!
//! The same function is called by:
//!   - `POST /api/agents/custom/try-connect`  (manual "test connection" button)
//!   - `AgentService::create/update_custom_agent`   (test-on-save)
//!
//! Both paths produce identical outcomes / error text.

use std::collections::HashMap;
use std::time::Duration;

use aionui_api_types::{AgentHandshake, TryConnectCustomAgentResponse};
use aionui_common::{CommandSpec, EnvVar};

use crate::protocol::acp_init_budget::{INIT_TIMEOUT_SECS, InitBudget};
use aionui_runtime::{NodeRuntimeProgressReporter, ResolvedCommand, ensure_runtime_command_with_reporter};
use tokio::sync::{broadcast, mpsc};
use tracing::{debug, warn};

use crate::capability::cli_process::CliAgentProcess;
use crate::protocol::acp::AcpProtocol;
use crate::protocol::error::AcpError;

use agent_client_protocol::schema::v1::NewSessionRequest;

/// Step 2 overall timeout. Belt-and-suspenders: `AcpProtocol::connect`
/// already caps the initialize RPC at 30 s, but a CLI that hangs
/// before writing any ACP frame at all is covered by this outer cap.
const STEP2_TIMEOUT: Duration = Duration::from_secs(35);

/// Grace period for the child to exit on its own after stdin close, before
/// we fall back to SIGKILL on the whole process group. Keep this short because
/// manual connection tests should return promptly after the ACP probe finishes.
const PROBE_KILL_GRACE: Duration = Duration::from_millis(500);

/// Probe a custom ACP agent.
///
/// Returns `Success` only if both `which` and the ACP `initialize`
/// handshake succeed. Any failure short-circuits into the
/// corresponding variant.
pub async fn try_connect_custom_agent(
    command: &str,
    args: &[String],
    env: &HashMap<String, String>,
    reporter: Option<&dyn NodeRuntimeProgressReporter>,
) -> TryConnectCustomAgentResponse {
    try_connect_custom_agent_with_catalog(command, args, env, reporter)
        .await
        .0
}

/// As [`try_connect_custom_agent`], plus the catalog the probe's `session/new`
/// advertised. The probe already pays for a full spawn + `initialize` +
/// `session/new`; callers that persist agent metadata use this variant so that
/// data is stored instead of thrown away. The partial is `Some` only on a
/// successful session whose agent advertised at least one of modes / models /
/// config options — an auth-gated or failing probe yields `None`, never an
/// empty write that would blank an existing catalog.
pub async fn try_connect_custom_agent_with_catalog(
    command: &str,
    args: &[String],
    env: &HashMap<String, String>,
    reporter: Option<&dyn NodeRuntimeProgressReporter>,
) -> (TryConnectCustomAgentResponse, Option<Box<AgentHandshake>>) {
    // ── Step 1 — which check ────────────────────────────────────────
    let head = first_token(command);
    let resolved = match ensure_runtime_command_with_reporter(head, reporter).await {
        Ok(resolved) => resolved,
        Err(error) => {
            return (
                TryConnectCustomAgentResponse::FailCli {
                    error: error.to_string(),
                },
                None,
            );
        }
    };
    debug!(program = %resolved.program.display(), "probe step 1 ok");

    // ── Step 2 — spawn + ACP initialize ─────────────────────────────
    let launch = describe_launch(&resolved.program, &resolved.args_prefix, args);
    let proc = match spawn_probe_process(resolved, args, env).await {
        Ok(proc) => proc,
        Err(msg) => return (TryConnectCustomAgentResponse::FailAcp { error: msg }, None),
    };

    let outcome = match tokio::time::timeout(STEP2_TIMEOUT, run_handshake(&proc, &launch)).await {
        Ok(outcome) => {
            let catalog = match &outcome {
                ProbeOutcome::Ok(catalog) => catalog.clone(),
                _ => None,
            };
            (outcome.into_response(), catalog)
        }
        Err(_) => (
            TryConnectCustomAgentResponse::FailAcp {
                error: format!("ACP handshake did not complete within {}s", STEP2_TIMEOUT.as_secs()),
            },
            None,
        ),
    };

    // Always tear down the whole process group. `kill_on_drop(true)` only
    // signals the direct child (e.g. `npm exec ...`) — wrapper CLIs spawn
    // grandchildren (`openclaw-acp`) that survive unless we SIGKILL the
    // group explicitly via `proc.kill()`.
    if let Err(error) = proc.kill(PROBE_KILL_GRACE).await {
        warn!(pid = proc.pid(), error = %error, "probe failed to kill process group");
    }

    outcome
}

fn first_token(command: &str) -> &str {
    command.split_whitespace().next().unwrap_or(command)
}

async fn spawn_probe_process(
    resolved: ResolvedCommand,
    args: &[String],
    env: &HashMap<String, String>,
) -> Result<CliAgentProcess, String> {
    let mut final_args: Vec<String> = resolved
        .args_prefix
        .iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    final_args.extend(args.iter().cloned());

    let mut final_env: Vec<EnvVar> = env
        .iter()
        .map(|(name, value)| EnvVar {
            name: name.clone(),
            value: value.clone(),
        })
        .collect();
    final_env.extend(resolved.env.iter().map(|(name, value)| EnvVar {
        name: name.to_string_lossy().into_owned(),
        value: value.to_string_lossy().into_owned(),
    }));

    let spec = CommandSpec {
        command: resolved.program,
        args: final_args,
        env: final_env,
        cwd: Some(std::env::temp_dir().to_string_lossy().into_owned()),
    };

    CliAgentProcess::spawn_for_sdk(spec)
        .await
        .map_err(|e| format!("spawn failed: {e}"))
}

/// How long to wait for a process whose pipe just closed to report its exit.
const EXIT_REPORT_WAIT: Duration = Duration::from_millis(500);
const MAX_STDERR_CHARS: usize = 600;
const MAX_LAUNCH_ARGS: usize = 12;
const MAX_LAUNCH_CHARS: usize = 300;

/// `program arg ...` as it was started, for error messages. Values that look
/// like credentials (`--token x`, `key=x`) are masked and the text is bounded.
fn describe_launch(program: &std::path::Path, prefix: &[std::ffi::OsString], args: &[String]) -> String {
    let name = program
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| program.display().to_string());
    let all = prefix
        .iter()
        .map(|a| a.to_string_lossy().into_owned())
        .chain(args.iter().cloned());
    let mut parts = vec![name];
    let mut mask_next = false;
    for arg in all.take(MAX_LAUNCH_ARGS) {
        let lower = arg.to_ascii_lowercase();
        let sensitive = ["token", "key", "secret", "password", "passwd"]
            .iter()
            .any(|w| lower.contains(w));
        if mask_next {
            parts.push("***".to_owned());
            mask_next = false;
        } else if sensitive && let Some((name, _)) = arg.split_once('=') {
            parts.push(format!("{name}=***"));
        } else {
            mask_next = sensitive && arg.starts_with('-');
            parts.push(arg);
        }
    }
    let mut text = parts.join(" ");
    if text.chars().count() > MAX_LAUNCH_CHARS {
        text = text.chars().take(MAX_LAUNCH_CHARS).collect::<String>() + "...";
    }
    text
}

/// Compose the probe failure text from what the process reported.
/// `status` is `None` while the process is still running or unreported.
fn failure_text(reason: &str, launch: &str, status: Option<&str>, exited_ok: bool, stderr: &str) -> String {
    let mut text = format!("{reason} (launched: {launch}");
    if let Some(status) = status {
        text.push_str(&format!("; status={status}"));
    }
    text.push(')');
    let stderr = stderr.trim();
    if !stderr.is_empty() {
        let chars: Vec<char> = stderr.chars().collect();
        let tail: String = chars[chars.len().saturating_sub(MAX_STDERR_CHARS)..].iter().collect();
        text.push_str(&format!(": {tail}"));
    } else if exited_ok {
        // Exit 0 with nothing on stdout or stderr: the program did not run as an
        // ACP agent at all (typically its launch arguments were not recognised
        // and it printed help or did nothing), not a handshake that went wrong.
        text.push_str(
            "; the CLI exited immediately with status 0 and no output, so it did not start in ACP mode - check the command and its arguments",
        );
    }
    text
}

async fn init_failure_message(proc: &CliAgentProcess, launch: &str, reason: &str) -> String {
    let exit = tokio::time::timeout(EXIT_REPORT_WAIT, proc.wait_for_exit())
        .await
        .ok()
        .flatten();
    let stderr = proc.take_stderr().await;
    let status = exit.map(|s| s.to_string());
    failure_text(
        reason,
        launch,
        status.as_deref(),
        exit.is_some_and(|s| s.success()),
        &stderr,
    )
}

/// Result of the Step 2 probe (`initialize` + `session/new`).
///
/// The probe reaches `session/new` so it can tell "reachable but not
/// authorized" (`Auth`) apart from other ACP failures (`Fail`) — `initialize`
/// alone returns `authMethods` even for already-authorized agents and cannot
/// make this distinction.
enum ProbeOutcome {
    /// Carries the catalog the successful `session/new` advertised (modes /
    /// models / config options), already projected into the same shape the live
    /// session path persists. `None` when the agent advertised nothing. Boxed to
    /// keep the enum small: the success payload dwarfs the error strings.
    Ok(Option<Box<AgentHandshake>>),
    Auth(String),
    Fail(String),
}

impl ProbeOutcome {
    fn into_response(self) -> TryConnectCustomAgentResponse {
        match self {
            ProbeOutcome::Ok(_) => TryConnectCustomAgentResponse::Success,
            ProbeOutcome::Auth(error) => TryConnectCustomAgentResponse::FailAuth { error },
            ProbeOutcome::Fail(error) => TryConnectCustomAgentResponse::FailAcp { error },
        }
    }
}

async fn run_handshake(proc: &CliAgentProcess, launch: &str) -> ProbeOutcome {
    let Some((stdin, stdout)) = proc.take_stdio().await else {
        return ProbeOutcome::Fail("stdio not available after spawn_for_sdk".to_string());
    };

    // Throwaway channels — a probe session never sends a prompt, so no events,
    // permission requests, or notifications are consumed.
    let (event_tx, _event_rx) = broadcast::channel(16);
    let (permission_tx, _permission_rx) = mpsc::channel(4);
    let (notification_tx, _notification_rx) = mpsc::channel(4);

    // Race the ACP initialize handshake against the child process exiting.
    // A misconfigured CLI (e.g. an invalid package launcher command) exits
    // almost immediately with a non-zero status; without this race the
    // `AcpProtocol::connect` call would block on its whole initialize budget
    // waiting for an `initialize` reply that will never arrive.
    //
    // The probe passes the steady-state budget rather than deriving a
    // cold-start one: the caller already caps this handshake at
    // `STEP2_TIMEOUT`, so a longer inner budget could never elapse. Keeping
    // the inner budget strictly below that cap also preserves which timeout
    // reports the failure — the inner one, as `InitTimeout`.
    let connect = AcpProtocol::connect(
        stdin,
        stdout,
        event_tx,
        permission_tx,
        notification_tx,
        "custom-agent-probe",
        None,
        InitBudget {
            timeout: Duration::from_secs(INIT_TIMEOUT_SECS),
            cold_start: false,
        },
    );
    let protocol = tokio::select! {
        biased;
        res = connect => match res {
            Ok(protocol) => protocol,
            // A CLI that never spoke ACP closes the pipe, and that is all the
            // transport can say ("Incoming transport closed"). Attach what the
            // process itself reports so the failure can be diagnosed.
            Err(e) => return ProbeOutcome::Fail(init_failure_message(proc, launch, &e.to_string()).await),
        },
        _ = proc.wait_for_exit() => {
            return ProbeOutcome::Fail(init_failure_message(proc, launch, "CLI exited before ACP initialize completed").await);
        }
    };

    // `initialize` only proves the agent speaks ACP, not that it is usable.
    // Open a real session (no prompt) so an auth-gated agent surfaces its
    // `auth_required` error here instead of silently appearing "online".
    // Keep the response: it carries the agent's advertised modes / models /
    // config options, which the caller persists into `agent_metadata` so the
    // picker is populated before the user ever opens a conversation. Discarding
    // it meant a probed-online agent still showed an empty picker.
    let outcome = match protocol.new_session(NewSessionRequest::new(std::env::temp_dir())).await {
        Ok((response, legacy_models)) => {
            // Same extraction the live session path performs (`agent_session_flow`):
            // models ride beside the response because the SDK dropped the field.
            let models = legacy_models
                .as_ref()
                .and_then(crate::manager::acp::legacy_session_model::LegacySessionModelState::from_state_value);
            ProbeOutcome::Ok(
                crate::manager::acp::catalog_forwarder::catalog_partial_from_session_new(
                    response.modes.as_ref(),
                    models.as_ref(),
                    response.config_options.as_deref(),
                )
                .map(Box::new),
            )
        }
        Err(AcpError::AuthRequired) => {
            ProbeOutcome::Auth("Agent reachable but requires login/authorization".to_string())
        }
        Err(e) => ProbeOutcome::Fail(format!("ACP session/new failed: {e}")),
    };

    // Drop `protocol` so its shutdown oneshot fires before the outer cleanup
    // path (or the drop guard for timeout-cancelled callers) reaps the process
    // tree. The probe session is throwaway; the process-group kill in the
    // caller tears down the session along with the CLI.
    drop(protocol);
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[tokio::test]
    async fn probe_returns_fail_cli_when_command_missing() {
        let resp = try_connect_custom_agent("aionui-definitely-does-not-exist-xyz", &[], &HashMap::new(), None).await;
        match resp {
            TryConnectCustomAgentResponse::FailCli { error } => {
                let lower = error.to_lowercase();
                assert!(
                    lower.contains("not found") || lower.contains("no such") || lower.contains("was not found"),
                    "expected 'not found' style message, got: {error}"
                );
            }
            other => panic!("expected FailCli, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn probe_returns_fail_acp_when_command_is_noop() {
        // `true` exits 0 immediately — Step 1 passes (on PATH), but the
        // process dies before ACP initialize completes, so Step 2 maps
        // to FailAcp.
        if cfg!(windows) {
            // `true` is a cmd builtin on Windows, not a standalone exe.
            return;
        }
        let resp = try_connect_custom_agent("true", &[], &HashMap::new(), None).await;
        assert!(
            matches!(resp, TryConnectCustomAgentResponse::FailAcp { .. }),
            "expected FailAcp, got {resp:?}"
        );
    }

    /// Regression for the production leak: a probe that talks to a wrapper
    /// CLI (`npm exec ...`, etc.) historically left the wrapper's grandchild
    /// process alive when the probe returned, because cleanup relied on
    /// `kill_on_drop(true)` which only signals the direct child. Repeated
    /// connection tests could otherwise accumulate zombie `openclaw-acp`
    /// processes.
    ///
    /// We exercise the public entry point with a CLI that exits immediately
    /// after backgrounding a long-lived grandchild — that's the production
    /// shape `npm exec openclaw --acp` collapses into when its own ACP
    /// handshake fails. The probe will see the wrapper exit (ACP fail), but
    /// by that point the grandchild has been forked. The fix must SIGKILL
    /// the whole process group before returning, so the grandchild dies too.
    #[cfg(unix)]
    #[tokio::test]
    async fn probe_kills_grandchild_left_behind_by_wrapper() {
        use std::time::Duration;
        use tokio::time::Instant;

        fn is_pid_alive(pid: i32) -> bool {
            unsafe { libc::kill(pid, 0) == 0 }
        }

        let marker = tempfile::NamedTempFile::new().unwrap();
        let marker_path = marker.path().to_owned();
        // Background a grandchild, write its pid, then exit. The probe will
        // observe `proc.wait_for_exit()` race the ACP handshake and return
        // FailAcp — the grandchild keeps running unless cleanup kills it.
        let script = format!("sleep 600 & printf '%s' \"$!\" > '{}'", marker_path.display());

        let resp = try_connect_custom_agent("sh", &["-c".to_string(), script], &HashMap::new(), None).await;
        assert!(
            matches!(resp, TryConnectCustomAgentResponse::FailAcp { .. }),
            "wrapper exits before ACP handshake; expected FailAcp, got {resp:?}"
        );

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut marker_contents = String::new();
        while Instant::now() < deadline {
            if let Ok(s) = std::fs::read_to_string(&marker_path)
                && !s.trim().is_empty()
            {
                marker_contents = s;
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let grandchild_pid: i32 = marker_contents.trim().parse().unwrap_or_else(|_| {
            panic!("wrapper did not write the grandchild pid: {marker_contents:?}");
        });

        // Give the OS a brief moment to reap after the probe returned.
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if !is_pid_alive(grandchild_pid) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        // Cleanup so a failing test does not leave an actual leak.
        unsafe {
            libc::kill(grandchild_pid, libc::SIGKILL);
        }
        panic!("grandchild pid={grandchild_pid} survived the probe — process group cleanup is broken");
    }

    #[test]
    fn acp_npx_01_launch_description_masks_credentials_and_is_bounded() {
        use std::ffi::OsString;
        let launch = describe_launch(
            std::path::Path::new("/rt/bin/npx"),
            &[OsString::from("-y")],
            &[
                "--package".into(),
                "pkg@1.2.3".into(),
                "agent".into(),
                "--api-key".into(),
                "sk-secret".into(),
                "token=abc".into(),
            ],
        );
        assert_eq!(launch, "npx -y --package pkg@1.2.3 agent --api-key *** token=***");
        let long = describe_launch(std::path::Path::new("x"), &[], &["a".repeat(500)]);
        assert!(long.chars().count() <= MAX_LAUNCH_CHARS + 3);
    }

    #[test]
    fn acp_npx_01_exit_zero_without_output_is_called_out_as_not_in_acp_mode() {
        let text = failure_text(
            "ACP initialize failed: Incoming transport closed",
            "npx -y pkg",
            Some("exit status: 0"),
            true,
            "",
        );
        assert!(text.contains("Incoming transport closed"));
        assert!(text.contains("launched: npx -y pkg"));
        assert!(text.contains("status=exit status: 0"));
        assert!(text.contains("did not start in ACP mode"));
    }

    #[test]
    fn acp_npx_01_stderr_tail_is_kept_and_replaces_the_generic_hint() {
        let noisy = format!("{}\nreal error", "x".repeat(2000));
        let text = failure_text("closed", "cli", Some("exit status: 1"), false, &noisy);
        assert!(text.ends_with("real error"));
        assert!(text.len() < 1000);
        assert!(!text.contains("did not start in ACP mode"));
        // exit 0 *with* stderr is not the silent-exit case
        assert!(!failure_text("closed", "cli", Some("exit status: 0"), true, "warn: x").contains("did not start"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn acp_npx_01_probe_of_a_silent_exit_zero_cli_reports_launch_and_status() {
        let resp = try_connect_custom_agent("true", &["--acp".to_string()], &HashMap::new(), None).await;
        match resp {
            TryConnectCustomAgentResponse::FailAcp { error } => {
                assert!(error.contains("launched: true --acp"), "got: {error}");
                assert!(error.contains("status="), "got: {error}");
                assert!(error.contains("did not start in ACP mode"), "got: {error}");
            }
            other => panic!("expected FailAcp, got {other:?}"),
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn acp_npx_01_probe_surfaces_stderr_of_a_crashing_cli() {
        let script = "echo boom-from-cli >&2; exit 3".to_string();
        let resp = try_connect_custom_agent("sh", &["-c".to_string(), script], &HashMap::new(), None).await;
        match resp {
            TryConnectCustomAgentResponse::FailAcp { error } => {
                assert!(error.contains("boom-from-cli"), "got: {error}");
                assert!(error.contains("status=exit status: 3"), "got: {error}");
            }
            other => panic!("expected FailAcp, got {other:?}"),
        }
    }
}
