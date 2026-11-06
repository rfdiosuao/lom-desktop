//! TEAM-ORCH-02 (#371): the model choices of a team member whose runtime has
//! not started.
//!
//! A member that was never dispatched work has no running agent to ask for its
//! config options, so the endpoint used to answer 409 and the client could not
//! even list the models to switch to. The agent's persisted catalog (written
//! after its last successful handshake) is enough to build that list.

use std::future::Future;

use aionui_api_types::{AcpConfigOptionDto, AcpConfigSelectOptionDto, GetConfigOptionsResponse};
use aionui_conversation::ConversationError;
use aionui_team::TeamError;
use serde_json::Value;

use super::team_conversation_adapters::map_conversation_update_error;

/// The live options when an agent is running; when none is (`ActiveAgentNotFound`)
/// the stored model-only snapshot, if there is one. Any other failure, and a
/// missing snapshot, keep reporting the original error — an empty picker is
/// never presented as an answer. `offline` is only awaited in the fallback case.
pub(super) async fn live_or_offline_options(
    live: Result<GetConfigOptionsResponse, ConversationError>,
    offline: impl Future<Output = Option<GetConfigOptionsResponse>>,
) -> Result<GetConfigOptionsResponse, TeamError> {
    match live {
        Ok(options) => Ok(options),
        Err(error @ ConversationError::ActiveAgentNotFound { .. }) => {
            offline.await.ok_or_else(|| map_conversation_update_error(error))
        }
        Err(error) => Err(map_conversation_update_error(error)),
    }
}

/// Model ids the stored catalog lists, or `None` when no catalog lists any.
pub(super) fn offline_model_ids(
    config_options_json: Option<&str>,
    available_models_json: Option<&str>,
) -> Option<Vec<String>> {
    let response = offline_model_options(config_options_json, available_models_json, None)?;
    Some(
        response.config_options[0]
            .options
            .iter()
            .map(|c| c.value.clone())
            .collect(),
    )
}

/// Build a model-only options response from the stored catalog. Returns `None`
/// when no catalog lists any model, so the caller keeps reporting that the
/// runtime is not ready instead of presenting an empty picker as an answer.
pub(super) fn offline_model_options(
    config_options_json: Option<&str>,
    available_models_json: Option<&str>,
    current_model: Option<&str>,
) -> Option<GetConfigOptionsResponse> {
    let options = models_from_config_options(config_options_json)
        .filter(|list| !list.is_empty())
        .or_else(|| models_from_available_models(available_models_json))
        .filter(|list| !list.is_empty())?;
    Some(GetConfigOptionsResponse {
        config_options: vec![AcpConfigOptionDto {
            id: "model".to_owned(),
            name: None,
            label: Some("Model".to_owned()),
            description: None,
            category: Some("model".to_owned()),
            option_type: "select".to_owned(),
            current_value: current_model.map(str::to_owned).filter(|value| !value.is_empty()),
            options,
        }],
    })
}

fn text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

fn choice(id: String, entry: &Value) -> AcpConfigSelectOptionDto {
    AcpConfigSelectOptionDto {
        value: id,
        name: text(entry, "name"),
        label: text(entry, "label"),
        description: text(entry, "description"),
    }
}

/// `config_options` column: the `model` select with `{value, name, description}` choices.
fn models_from_config_options(raw: Option<&str>) -> Option<Vec<AcpConfigSelectOptionDto>> {
    let parsed: Value = serde_json::from_str(raw?).ok()?;
    let model = parsed.as_array()?.iter().find(|option| {
        text(option, "id").as_deref() == Some("model") || text(option, "category").as_deref() == Some("model")
    })?;
    let choices = model.get("options")?.as_array()?;
    Some(
        choices
            .iter()
            .filter_map(|entry| text(entry, "value").map(|id| choice(id, entry)))
            .collect(),
    )
}

/// `available_models` column: `{available_models: [{id, label|name, description}]}`.
fn models_from_available_models(raw: Option<&str>) -> Option<Vec<AcpConfigSelectOptionDto>> {
    let parsed: Value = serde_json::from_str(raw?).ok()?;
    let list = parsed.get("available_models")?.as_array()?;
    Some(
        list.iter()
            .filter_map(|entry| text(entry, "id").map(|id| choice(id, entry)))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::{live_or_offline_options, offline_model_ids, offline_model_options};
    use aionui_api_types::GetConfigOptionsResponse;
    use aionui_conversation::ConversationError;
    use aionui_team::TeamError;

    const CONFIG_OPTIONS: &str = r#"[
        {"id":"mode","category":"mode","type":"select","options":[{"value":"default"}]},
        {"id":"model","category":"model","type":"select","currentValue":"hy4free",
         "options":[{"value":"hy4free","name":"Hy4"},{"value":"hy3","name":"Hy3"}]}
    ]"#;

    #[test]
    fn team_orch_02_371_lists_models_from_the_stored_config_options() {
        let response = offline_model_options(Some(CONFIG_OPTIONS), None, Some("hy4free")).expect("catalog has models");
        let model = &response.config_options[0];
        assert_eq!(model.id, "model");
        assert_eq!(model.current_value.as_deref(), Some("hy4free"));
        let values: Vec<_> = model.options.iter().map(|choice| choice.value.as_str()).collect();
        assert_eq!(values, ["hy4free", "hy3"]);
        assert_eq!(model.options[1].name.as_deref(), Some("Hy3"));
    }

    #[test]
    fn team_orch_02_371_falls_back_to_the_available_models_column() {
        let models = r#"{"available_models":[{"id":"hy3","label":"Hy3"}]}"#;
        let response = offline_model_options(None, Some(models), None).expect("fallback column has models");
        assert_eq!(response.config_options[0].options[0].value, "hy3");
        assert_eq!(response.config_options[0].options[0].label.as_deref(), Some("Hy3"));
        assert_eq!(response.config_options[0].current_value, None);
    }

    #[test]
    fn team_orch_02_371_no_catalog_means_no_answer() {
        assert!(offline_model_options(None, None, Some("hy4free")).is_none());
        assert!(offline_model_options(Some("[]"), Some("not json"), None).is_none());
        assert!(offline_model_options(Some(r#"[{"id":"model","options":[]}]"#), None, None).is_none());
    }

    fn snapshot() -> GetConfigOptionsResponse {
        offline_model_options(Some(CONFIG_OPTIONS), None, Some("hy4free")).unwrap()
    }
    fn not_running() -> ConversationError {
        ConversationError::ActiveAgentNotFound {
            conversation_id: "c1".into(),
        }
    }

    #[test]
    fn team_orch_02_371_catalog_ids_for_validation() {
        assert_eq!(
            offline_model_ids(Some(CONFIG_OPTIONS), None).unwrap(),
            ["hy4free", "hy3"]
        );
        assert!(offline_model_ids(None, None).is_none());
    }

    #[tokio::test]
    async fn team_orch_02_371_no_running_agent_serves_the_stored_snapshot() {
        let got = live_or_offline_options(Err(not_running()), async { Some(snapshot()) })
            .await
            .expect("fallback answers");
        assert_eq!(got.config_options[0].options.len(), 2);
    }

    #[tokio::test]
    async fn team_orch_02_371_no_running_agent_and_no_catalog_stays_not_ready() {
        let err = live_or_offline_options(Err(not_running()), async { None })
            .await
            .unwrap_err();
        assert!(matches!(err, TeamError::RuntimeNotReady { .. }));
    }

    #[tokio::test]
    async fn team_orch_02_371_a_live_agent_is_never_replaced_by_the_snapshot() {
        let live = GetConfigOptionsResponse { config_options: vec![] };
        let got = live_or_offline_options(Ok(live.clone()), async { panic!("fallback must not run") })
            .await
            .unwrap();
        assert_eq!(got, live);
    }

    #[tokio::test]
    async fn team_orch_02_371_other_failures_do_not_trigger_the_fallback() {
        let err = ConversationError::NotFound { id: "c1".into() };
        let got = live_or_offline_options(Err(err), async { panic!("fallback must not run") }).await;
        assert!(got.is_err());
    }
}
