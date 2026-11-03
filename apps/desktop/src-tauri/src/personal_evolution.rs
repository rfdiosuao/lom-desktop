//! Auth-guarded frontend invokes these commands; filesystem roots are derived natively.
use tauri::Manager;

#[tauri::command]
pub async fn personal_reflect(
    user: String,
    reply: String,
    base_url: String,
    api_key: String,
    model: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::personal_reflection::reflect(&user, &reply, &base_url, &api_key, &model)
    })
    .await
    .map_err(|_| "personal.learning_worker".to_string())?
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LearningRequest {
    account: String,
    id: String,
    name: String,
    directory: String,
    turn: String,
    user: String,
    reply: String,
    evidence: String,
    proposals: String,
    expected_version: Option<u64>,
}
#[tauri::command]
pub async fn personal_apply_learning(
    app: tauri::AppHandle,
    request: LearningRequest,
) -> Result<crate::personal_learning::Applied, String> {
    let base = app.path().app_data_dir().map_err(|_| "personal.data_dir")?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::personal::prepare(&base, &request.account, &request.id, &request.name)?;
        if root.to_string_lossy() != request.directory {
            return Err("personal.learning_identity".into());
        }
        crate::personal_learning::apply_checked(
            &root,
            &request.turn,
            &request.user,
            &request.reply,
            &request.evidence,
            &request.proposals,
            request.expected_version,
        )
    })
    .await
    .map_err(|_| "personal.learning_worker".to_string())?
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VersionRequest {
    account: String,
    id: String,
    #[serde(rename = "name")]
    _name: String,
    directory: String,
    expected_version: Option<u64>,
    rollback: Option<u64>,
}
#[tauri::command]
pub async fn personal_memory_versions(
    app: tauri::AppHandle,
    request: VersionRequest,
) -> Result<serde_json::Value, String> {
    let base = app.path().app_data_dir().map_err(|_| "personal.data_dir")?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::personal::existing_directory(&base, &request.account, &request.id)?;
        if root.to_string_lossy() != request.directory {
            return Err("personal.learning_identity".into());
        }
        if let Some(target) = request.rollback {
            let expected = request
                .expected_version
                .ok_or("personal.learning_conflict")?;
            let version = crate::personal_learning::restore(&root, expected, target)?;
            Ok(serde_json::json!(version))
        } else {
            serde_json::to_value(crate::personal_learning::versions(&root)?)
                .map_err(|_| "personal.learning_storage".into())
        }
    })
    .await
    .map_err(|_| "personal.learning_worker".to_string())?
}
