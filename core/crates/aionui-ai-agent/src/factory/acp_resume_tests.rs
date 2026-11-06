use super::*;
use crate::{AgentSendError, AgentStreamEvent, IAgentTask, IMockAgent};
use aionui_common::{AgentKillReason, AgentType, ConversationStatus, TimestampMs};
use aionui_db::{
    CreateAcpSessionParams, IAcpSessionRepository, SaveRuntimeStateParams, SqliteAcpSessionRepository,
    init_database_memory,
};
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::{broadcast, mpsc};

struct PreparedAgent {
    mode: Option<&'static str>,
    kills: AtomicUsize,
}
#[async_trait::async_trait]
impl IAgentTask for PreparedAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::Acp
    }
    fn conversation_id(&self) -> &str {
        "conv-1"
    }
    fn workspace(&self) -> &str {
        "/isolated"
    }
    fn status(&self) -> Option<ConversationStatus> {
        None
    }
    fn last_activity_at(&self) -> TimestampMs {
        0
    }
    fn subscribe(&self) -> broadcast::Receiver<AgentStreamEvent> {
        broadcast::channel(1).1
    }
    async fn send_message(&self, _: crate::types::SendMessageData) -> Result<(), AgentSendError> {
        panic!("A permission rebuild must never replay a prompt")
    }
    async fn cancel(&self) -> Result<(), AgentError> {
        panic!("An idle permission rebuild must never cancel a turn")
    }
    fn kill(&self, _: Option<AgentKillReason>) -> Result<(), AgentError> {
        self.kills.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}
#[async_trait::async_trait]
impl IMockAgent for PreparedAgent {
    async fn get_config_options(&self) -> Result<aionui_api_types::GetConfigOptionsResponse, AgentError> {
        let mode = self
            .mode
            .ok_or_else(|| AgentError::bad_request("config query failed"))?;
        Ok(serde_json::from_value(
            serde_json::json!({"config_options":[{"id":"mode","type":"select","current_value":mode,"options":[]}]}),
        )
        .unwrap())
    }
}

#[tokio::test]
async fn explicit_permission_factory_persists_only_same_session_confirmed_mode() {
    for case in [
        "success",
        "mode_mismatch",
        "anchor_mismatch",
        "query_failure",
        "warmup_failure",
        "missing_raw_mode",
    ] {
        let db = init_database_memory().await.unwrap();
        sqlx::query("INSERT OR IGNORE INTO users (id,user_type,username,password_hash,status,session_generation,created_at,updated_at) VALUES ('user-1','local','user-1','hash','active',0,1,1)").execute(db.pool()).await.unwrap();
        sqlx::query("INSERT INTO conversations (id,user_id,name,type,extra,status,pinned,created_at,updated_at) VALUES ('conv-1','user-1','Test','acp','{}','pending',0,1,1)").execute(db.pool()).await.unwrap();
        let repo: Arc<dyn IAcpSessionRepository> = Arc::new(SqliteAcpSessionRepository::new(db.pool().clone()));
        repo.create(&CreateAcpSessionParams {
            user_id: "user-1",
            conversation_id: "conv-1",
            agent_source: "builtin",
            agent_id: "qoder",
        })
        .await
        .unwrap();
        repo.update_session_id_for_user("user-1", "conv-1", "original-session")
            .await
            .unwrap();
        repo.save_runtime_state_for_user(
            "user-1",
            "conv-1",
            &SaveRuntimeStateParams {
                current_mode_id: Some(Some("default")),
                config_selections_json: Some(Some("{\"mode\":\"default\",\"model\":\"retained\"}")),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let before = repo.load_runtime_state_for_user("user-1", "conv-1").await.unwrap();
        let persistence = crate::AcpSessionSyncService::new(repo.clone());
        let agent = Arc::new(PreparedAgent {
            mode: if case == "query_failure" {
                None
            } else if case == "mode_mismatch" {
                Some("default")
            } else {
                Some("yolo")
            },
            kills: AtomicUsize::new(0),
        });
        let instance = AgentInstance::Mock(agent.clone());
        let (tx, rx) = mpsc::channel(4);
        // A failed replacement may already have queued an anchor/config update.
        // It must not get a persistence consumer on any error path.
        tx.send(
            crate::manager::acp::agent_event_tracker::AcpSessionEvent::ObservedModeSynced {
                mode: crate::shared_kernel::ModeId::new("yolo"),
            },
        )
        .await
        .unwrap();
        tx.send(
            crate::manager::acp::agent_event_tracker::AcpSessionEvent::SessionAssigned {
                session_id: crate::shared_kernel::SessionId::new(if case == "success" {
                    "original-session"
                } else {
                    "replacement-session"
                }),
            },
        )
        .await
        .unwrap();
        drop(tx);
        let prepared = if case == "warmup_failure" {
            Err(AgentError::bad_request("resume failed"))
        } else {
            Ok(())
        };
        let requirement = RequiredResumeMode {
            mode: "yolo",
            raw_mode: if case == "missing_raw_mode" { None } else { Some("yolo") },
            expected_session_id: Some("original-session"),
            actual_session_id: Some(if case == "anchor_mismatch" {
                "replacement-session"
            } else {
                "original-session"
            }),
        };
        let result = finish_acp_warmup(
            &instance,
            prepared,
            Some(requirement),
            &persistence,
            "user-1".into(),
            "conv-1".into(),
            rx,
        )
        .await;
        // Closed input flushes immediately if and only if a consumer was attached.
        tokio::task::yield_now().await;
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        if case == "success" {
            result.unwrap();
            assert_eq!(agent.kills.load(Ordering::SeqCst), 0);
            assert_eq!(
                repo.load_runtime_state_for_user("user-1", "conv-1")
                    .await
                    .unwrap()
                    .unwrap()
                    .current_mode_id
                    .as_deref(),
                Some("yolo")
            );
        } else {
            assert!(result.is_err(), "{case}");
            assert_eq!(agent.kills.load(Ordering::SeqCst), 1, "{case}");
            assert_eq!(
                repo.load_runtime_state_for_user("user-1", "conv-1").await.unwrap(),
                before,
                "{case}: snapshot changed"
            );
            assert_eq!(
                repo.get_for_user("user-1", "conv-1")
                    .await
                    .unwrap()
                    .unwrap()
                    .session_id
                    .as_deref(),
                Some("original-session"),
                "{case}: anchor changed"
            );
        }
    }
}
