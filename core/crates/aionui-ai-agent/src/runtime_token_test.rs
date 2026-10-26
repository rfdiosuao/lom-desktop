use super::*;

#[test]
fn validates_issued_token_for_matching_runtime_context() {
    let service = RuntimeTokenService::new();
    let issue = service.issue(
        "user-1",
        "conv-1",
        "gen-1",
        [RuntimeTokenScope::TeamContext, RuntimeTokenScope::TeamCall],
    );

    let claims = service
        .validate(
            Some(&issue.token),
            "user-1",
            "conv-1",
            RuntimeTokenScope::TeamCall,
            "gen-1",
        )
        .unwrap();
    assert_eq!(claims.user_id, "user-1");
    assert!(claims.scopes.contains(&RuntimeTokenScope::TeamCall));
}

#[test]
fn rejects_missing_mismatched_scope_and_generation() {
    let service = RuntimeTokenService::new();
    let issue = service.issue("user-1", "conv-1", "gen-1", [RuntimeTokenScope::TeamContext]);
    assert_eq!(
        service.validate(None, "user-1", "conv-1", RuntimeTokenScope::TeamContext, "gen-1"),
        Err(RuntimeTokenError::Missing)
    );
    assert_eq!(
        service.validate(
            Some(&issue.token),
            "user-1",
            "conv-1",
            RuntimeTokenScope::TeamCall,
            "gen-1"
        ),
        Err(RuntimeTokenError::ScopeMissing)
    );
    assert_eq!(
        service.validate(
            Some(&issue.token),
            "user-1",
            "conv-1",
            RuntimeTokenScope::TeamContext,
            "gen-2"
        ),
        Err(RuntimeTokenError::GenerationMismatch)
    );
}

#[test]
fn invalidation_removes_matching_conversation_tokens() {
    let service = RuntimeTokenService::new();
    let issue = service.issue("user-1", "conv-1", "gen-1", [RuntimeTokenScope::TeamContext]);
    service.invalidate_conversation("user-1", "conv-1");
    assert_eq!(
        service.validate(
            Some(&issue.token),
            "user-1",
            "conv-1",
            RuntimeTokenScope::TeamContext,
            "gen-1"
        ),
        Err(RuntimeTokenError::Unknown)
    );
}

#[test]
fn issuing_replacement_token_invalidates_previous_conversation_token() {
    let service = RuntimeTokenService::new();
    let first = service.issue(
        "user-1",
        "conv-1",
        "gen-1",
        [RuntimeTokenScope::TeamContext, RuntimeTokenScope::TeamCall],
    );
    let second = service.issue(
        "user-1",
        "conv-1",
        "gen-2",
        [RuntimeTokenScope::TeamContext, RuntimeTokenScope::TeamCall],
    );

    assert_eq!(
        service.validate(
            Some(&first.token),
            "user-1",
            "conv-1",
            RuntimeTokenScope::TeamCall,
            "gen-1"
        ),
        Err(RuntimeTokenError::Unknown)
    );
    service
        .validate(
            Some(&second.token),
            "user-1",
            "conv-1",
            RuntimeTokenScope::TeamCall,
            "gen-2",
        )
        .unwrap();
}

#[test]
fn repeated_issue_for_same_runtime_generation_reuses_existing_token() {
    let service = RuntimeTokenService::new();
    let first = service.issue(
        "user-1",
        "conv-1",
        "gen-1",
        [RuntimeTokenScope::TeamContext, RuntimeTokenScope::TeamCall],
    );
    let second = service.issue(
        "user-1",
        "conv-1",
        "gen-1",
        [RuntimeTokenScope::TeamContext, RuntimeTokenScope::TeamCall],
    );

    assert_eq!(first.token, second.token);
    service
        .validate(
            Some(&first.token),
            "user-1",
            "conv-1",
            RuntimeTokenScope::TeamCall,
            "gen-1",
        )
        .unwrap();
}

#[test]
fn token_lifetime_is_bound_to_explicit_invalidation_not_wall_clock_ttl() {
    let service = RuntimeTokenService::new();
    let issue = service.issue("user-1", "conv-1", "gen-1", [RuntimeTokenScope::TeamContext]);

    service
        .validate(
            Some(&issue.token),
            "user-1",
            "conv-1",
            RuntimeTokenScope::TeamContext,
            "gen-1",
        )
        .unwrap();
}

#[test]
fn invalidate_conversation_id_revokes_tokens_for_conversation() {
    let service = RuntimeTokenService::new();
    let issue = service.issue("user-1", "conv-1", "gen-1", [RuntimeTokenScope::TeamContext]);

    service.invalidate_conversation_id("conv-1");

    assert_eq!(
        service.validate(
            Some(&issue.token),
            "user-1",
            "conv-1",
            RuntimeTokenScope::TeamContext,
            "gen-1"
        ),
        Err(RuntimeTokenError::Unknown)
    );
}

#[test]
fn debug_redacts_raw_token() {
    let service = RuntimeTokenService::new();
    let issue = service.issue("user-1", "conv-1", "gen-1", [RuntimeTokenScope::TeamContext]);
    let debug = format!("{issue:?}");
    assert!(!debug.contains(&issue.token));
    assert!(debug.contains("<redacted>"));
}

#[test]
fn s06_c_search_scope_is_bound_to_user_conversation_and_generation() {
    let service = RuntimeTokenService::new();
    let issue = service.issue("user-1", "conv-1", "gen-1", [RuntimeTokenScope::SearchCall]);

    service
        .validate(
            Some(&issue.token),
            "user-1",
            "conv-1",
            RuntimeTokenScope::SearchCall,
            "gen-1",
        )
        .unwrap();
    assert_eq!(
        service.validate(
            Some(&issue.token),
            "user-2",
            "conv-1",
            RuntimeTokenScope::SearchCall,
            "gen-1"
        ),
        Err(RuntimeTokenError::UserMismatch)
    );
    assert_eq!(
        service.validate(
            Some(&issue.token),
            "user-1",
            "conv-2",
            RuntimeTokenScope::SearchCall,
            "gen-1"
        ),
        Err(RuntimeTokenError::ConversationMismatch)
    );
    assert_eq!(
        service.validate(
            Some(&issue.token),
            "user-1",
            "conv-1",
            RuntimeTokenScope::SearchCall,
            "gen-2"
        ),
        Err(RuntimeTokenError::GenerationMismatch)
    );
    assert_eq!(RuntimeTokenScope::SearchCall.as_str(), "search:call");
}

#[test]
fn s06_c_helper_only_token_cannot_call_search() {
    let service = RuntimeTokenService::new();
    let issue = service.issue("user-1", "conv-1", "gen-1", [RuntimeTokenScope::ConversationHelper]);
    assert_eq!(
        service.validate(
            Some(&issue.token),
            "user-1",
            "conv-1",
            RuntimeTokenScope::SearchCall,
            "gen-1"
        ),
        Err(RuntimeTokenError::ScopeMissing)
    );
}

#[test]
fn s06_c_search_token_cannot_use_team_or_helper_scopes() {
    let service = RuntimeTokenService::new();
    let issue = service.issue("user-1", "conv-1", "gen-1", [RuntimeTokenScope::SearchCall]);
    for scope in [
        RuntimeTokenScope::TeamContext,
        RuntimeTokenScope::TeamCall,
        RuntimeTokenScope::ConversationHelper,
    ] {
        assert_eq!(
            service.validate(Some(&issue.token), "user-1", "conv-1", scope, "gen-1"),
            Err(RuntimeTokenError::ScopeMissing),
            "{scope:?} must not be reachable with a search-only token"
        );
    }
}

#[test]
fn s06_c_generation_change_revokes_search_token() {
    let service = RuntimeTokenService::new();
    let issue = service.issue("user-1", "conv-1", "gen-1", [RuntimeTokenScope::SearchCall]);

    service.invalidate_generation("conv-1", "gen-1");

    assert_eq!(
        service.validate(
            Some(&issue.token),
            "user-1",
            "conv-1",
            RuntimeTokenScope::SearchCall,
            "gen-1"
        ),
        Err(RuntimeTokenError::Unknown)
    );
}

#[test]
fn s06_c_core_restart_drops_search_tokens() {
    let before_restart = RuntimeTokenService::new();
    let issue = before_restart.issue("user-1", "conv-1", "gen-1", [RuntimeTokenScope::SearchCall]);
    let after_restart = RuntimeTokenService::new();

    assert_eq!(
        after_restart.validate(
            Some(&issue.token),
            "user-1",
            "conv-1",
            RuntimeTokenScope::SearchCall,
            "gen-1"
        ),
        Err(RuntimeTokenError::Unknown),
        "the token map is in memory, so a new core process cannot honour old tokens"
    );
}

#[test]
fn s06_c_account_change_invalidates_only_search_scoped_tokens() {
    let service = RuntimeTokenService::new();
    let search = service.issue(
        "user-1",
        "conv-1",
        "gen-1",
        [RuntimeTokenScope::ConversationHelper, RuntimeTokenScope::SearchCall],
    );
    let helper = service.issue("user-2", "conv-2", "gen-1", [RuntimeTokenScope::ConversationHelper]);

    service.invalidate_user_scope("user-1", RuntimeTokenScope::SearchCall);

    assert_eq!(
        service.validate(
            Some(&search.token),
            "user-1",
            "conv-1",
            RuntimeTokenScope::SearchCall,
            "gen-1"
        ),
        Err(RuntimeTokenError::ScopeMissing)
    );
    service
        .validate(
            Some(&helper.token),
            "user-2",
            "conv-2",
            RuntimeTokenScope::ConversationHelper,
            "gen-1",
        )
        .unwrap();
}

#[test]
fn s06_c_account_change_preserves_live_team_and_helper_permissions() {
    let service = RuntimeTokenService::new();
    let issue = service.issue(
        "user-1",
        "conv-1",
        "gen-1",
        [
            RuntimeTokenScope::ConversationHelper,
            RuntimeTokenScope::TeamContext,
            RuntimeTokenScope::TeamCall,
            RuntimeTokenScope::SearchCall,
        ],
    );
    service.invalidate_user_scope("user-1", RuntimeTokenScope::SearchCall);
    assert_eq!(
        service.validate(
            Some(&issue.token),
            "user-1",
            "conv-1",
            RuntimeTokenScope::SearchCall,
            "gen-1"
        ),
        Err(RuntimeTokenError::ScopeMissing)
    );
    for scope in [
        RuntimeTokenScope::TeamContext,
        RuntimeTokenScope::TeamCall,
        RuntimeTokenScope::ConversationHelper,
    ] {
        service
            .validate(Some(&issue.token), "user-1", "conv-1", scope, "gen-1")
            .unwrap();
    }
    service.invalidate_user_scope("user-1", RuntimeTokenScope::SearchCall);
    service
        .validate(
            Some(&issue.token),
            "user-1",
            "conv-1",
            RuntimeTokenScope::TeamCall,
            "gen-1",
        )
        .unwrap();
    // Conversation build options request the full original grant on later turns.
    let next = service.issue(
        "user-1",
        "conv-1",
        "gen-1",
        [
            RuntimeTokenScope::ConversationHelper,
            RuntimeTokenScope::TeamContext,
            RuntimeTokenScope::TeamCall,
            RuntimeTokenScope::SearchCall,
        ],
    );
    assert_eq!(next.token, issue.token);
    assert!(!next.claims.scopes.contains(&RuntimeTokenScope::SearchCall));
    assert_eq!(
        service.validate(
            Some(&next.token),
            "user-1",
            "conv-1",
            RuntimeTokenScope::SearchCall,
            "gen-1"
        ),
        Err(RuntimeTokenError::ScopeMissing)
    );
    service
        .validate(
            Some(&issue.token),
            "user-1",
            "conv-1",
            RuntimeTokenScope::TeamCall,
            "gen-1",
        )
        .unwrap();
    service.invalidate_generation("conv-1", "gen-1");
    assert_eq!(
        service.validate(
            Some(&issue.token),
            "user-1",
            "conv-1",
            RuntimeTokenScope::TeamCall,
            "gen-1"
        ),
        Err(RuntimeTokenError::Unknown)
    );
}

#[test]
fn s06_c_search_revocation_covers_all_user_sessions_without_cross_user_effects() {
    let service = RuntimeTokenService::new();
    let first = service.issue("user-1", "conv-1", "gen-1", [RuntimeTokenScope::SearchCall]);
    let second = service.issue("user-1", "conv-2", "gen-1", [RuntimeTokenScope::SearchCall]);
    let other = service.issue("user-2", "conv-3", "gen-1", [RuntimeTokenScope::SearchCall]);
    service.invalidate_user_scope("user-1", RuntimeTokenScope::SearchCall);
    for (issue, conv) in [(first, "conv-1"), (second, "conv-2")] {
        assert_eq!(
            service.validate(
                Some(&issue.token),
                "user-1",
                conv,
                RuntimeTokenScope::SearchCall,
                "gen-1"
            ),
            Err(RuntimeTokenError::Unknown)
        );
    }
    service
        .validate(
            Some(&other.token),
            "user-2",
            "conv-3",
            RuntimeTokenScope::SearchCall,
            "gen-1",
        )
        .unwrap();
}
