//! TEAM-ORCH-01 (#372): an agent turn that ended without any output is a
//! failed turn, not a successful one.
//!
//! Some agent CLIs swallow an upstream model failure (for example an HTTP 429
//! quota error that only lands in the CLI's own log file) and still answer the
//! ACP `session/prompt` request with a clean `end_turn` and no content. Reported
//! as `Finish`, the turn looks successful: a team leader that "ran" this way
//! never dispatches work and nothing tells the user why.
//!
//! The tip codes in `agent_session_flow` keep describing the *likely* cause
//! (needs sign-in, token limit). This module decides what terminal event the
//! turn gets: an error event with a retryable, machine-readable code.

use super::agent_session_flow::PromptOutcome;
use crate::error::AgentError;
use crate::protocol::events::{ErrorEventData, TipsEventData};
use crate::protocol::send_error::AgentSendError;
use aionui_api_types::SlashCommandItem;

/// Tip code for an empty end-of-turn with no more specific attributed cause.
pub(super) const GENERIC_EMPTY_TURN_TIP: &str = "ACP_EMPTY_TURN";

/// Detail text handed to the upstream-error classifier. The classifier maps it
/// to the retryable `UserLlmProviderEmptyResponse` code.
const EMPTY_TURN_DETAIL: &str = "Empty response from LLM: the agent ended the turn without any output";

/// Terminal error for a turn that ended `end_turn` with no text and no tool
/// call. Always retryable so callers can resend or switch model.
pub(super) fn empty_turn_failure() -> ErrorEventData {
    AgentSendError::from_agent_error(AgentError::bad_gateway(EMPTY_TURN_DETAIL.to_owned())).into_stream_error()
}

/// Turn the "ended with no output" outcome into a failure — unless the user ran a
/// slash command, where finishing without output is a normal result (the
/// command's own tip stays). Turns that produced text or tool calls arrive here
/// as `Completed` and pass through untouched, as does every other outcome.
pub(super) fn fail_unexplained_empty_turn(outcome: PromptOutcome, command: Option<&SlashCommandItem>) -> PromptOutcome {
    match outcome {
        PromptOutcome::InfoTip { session_id, tips } if command.is_none() => {
            PromptOutcome::EmptyTurnFailed { session_id, tips }
        }
        other => other,
    }
}

/// Whether the tip that accompanies an empty turn carries cause information
/// worth showing on its own (sign-in hint, token limit). The generic tip has no
/// content, so the error event replaces it instead of stacking a second,
/// empty notice on top.
pub(super) fn tip_adds_information(tips: &TipsEventData) -> bool {
    tips.code.as_deref() != Some(GENERIC_EMPTY_TURN_TIP)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::events::TipType;
    use aionui_api_types::AgentErrorCode;

    fn tip(code: &str) -> TipsEventData {
        TipsEventData {
            content: String::new(),
            tip_type: TipType::Info,
            code: Some(code.to_owned()),
            params: None,
            supersedes_key: None,
        }
    }

    #[test]
    fn team_orch_01_372_empty_turn_is_a_retryable_provider_failure() {
        let error = empty_turn_failure();
        assert_eq!(error.code, Some(AgentErrorCode::UserLlmProviderEmptyResponse));
        assert_eq!(error.retryable, Some(true));
    }

    fn command() -> SlashCommandItem {
        SlashCommandItem {
            command: "ctx-flush".into(),
            description: "Flush context".into(),
            completion_behavior: None,
            empty_turn_tip_code: None,
            empty_turn_tip_params: None,
        }
    }

    #[test]
    fn team_orch_01_372_plain_empty_end_turn_becomes_a_failure() {
        let outcome = PromptOutcome::InfoTip {
            session_id: "s".into(),
            tips: tip("ACP_EMPTY_TURN"),
        };
        assert!(matches!(
            fail_unexplained_empty_turn(outcome, None),
            PromptOutcome::EmptyTurnFailed { .. }
        ));
    }

    #[test]
    fn team_orch_01_372_slash_command_without_output_is_not_a_failure() {
        let outcome = PromptOutcome::InfoTip {
            session_id: "s".into(),
            tips: tip("ACP_EMPTY_TURN"),
        };
        assert!(matches!(
            fail_unexplained_empty_turn(outcome, Some(&command())),
            PromptOutcome::InfoTip { .. }
        ));
    }

    #[test]
    fn team_orch_01_372_turns_with_output_and_other_outcomes_pass_through() {
        // A turn that produced text or tool calls is classified `Completed` upstream.
        let done = PromptOutcome::Completed { session_id: "s".into() };
        assert!(matches!(
            fail_unexplained_empty_turn(done, None),
            PromptOutcome::Completed { .. }
        ));
        let cancelled = PromptOutcome::Cancelled { session_id: "s".into() };
        assert!(matches!(
            fail_unexplained_empty_turn(cancelled, None),
            PromptOutcome::Cancelled { .. }
        ));
        // Non-benign empty stop reasons keep their own warning tip and finish.
        let warn = PromptOutcome::WarningTip {
            session_id: "s".into(),
            tips: tip("ACP_EMPTY_TURN_MAX_TOKENS"),
        };
        assert!(matches!(
            fail_unexplained_empty_turn(warn, None),
            PromptOutcome::WarningTip { .. }
        ));
    }

    #[test]
    fn team_orch_01_372_generic_tip_is_replaced_by_the_error() {
        assert!(!tip_adds_information(&tip("ACP_EMPTY_TURN")));
    }

    #[test]
    fn team_orch_01_372_cause_specific_tips_are_kept() {
        assert!(tip_adds_information(&tip("ACP_EMPTY_TURN_NEEDS_AUTH")));
        assert!(tip_adds_information(&tip("ACP_EMPTY_TURN_TOKEN_LIMIT")));
    }
}
