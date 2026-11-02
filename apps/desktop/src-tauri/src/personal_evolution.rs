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
        crate::personal_learning::apply(
            &root,
            &request.turn,
            &request.user,
            &request.reply,
            &request.evidence,
            &request.proposals,
        )
    })
    .await
    .map_err(|_| "personal.learning_worker".to_string())?
}
