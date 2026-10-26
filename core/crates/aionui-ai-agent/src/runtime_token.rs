use std::collections::HashSet;
use std::time::SystemTime;

use dashmap::DashMap;
use getrandom::getrandom;
use sha2::{Digest, Sha256};

pub const TEAM_RUNTIME_TOKEN_SESSION_GENERATION: &str = "default";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RuntimeTokenScope {
    TeamContext,
    TeamCall,
    /// Conversation-scoped helper CLI access (`aioncore config` / `diagnose`
    /// invoked from inside an agent conversation). Grants the token holder the
    /// bound user's identity on ordinary API routes via the auth middleware's
    /// runtime-token channel — it does NOT grant team-tools access.
    ConversationHelper,
    /// Conversation-scoped Lom search bridge access. The token holder may call
    /// `lom_search` / `lom_fetch` through the loopback runtime route; it never
    /// grants the cloud login session or provider credentials.
    SearchCall,
}

impl RuntimeTokenScope {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TeamContext => "team:context",
            Self::TeamCall => "team:call",
            Self::ConversationHelper => "conversation:helper",
            Self::SearchCall => "search:call",
        }
    }
}

#[derive(Clone)]
pub struct RuntimeTokenIssue {
    pub token: String,
    pub claims: RuntimeTokenClaims,
}

impl std::fmt::Debug for RuntimeTokenIssue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RuntimeTokenIssue")
            .field("token", &"<redacted>")
            .field("claims", &self.claims)
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeTokenClaims {
    pub user_id: String,
    pub conversation_id: String,
    pub scopes: HashSet<RuntimeTokenScope>,
    pub issued_at: SystemTime,
    pub session_generation: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeTokenError {
    Missing,
    Unknown,
    UserMismatch,
    ConversationMismatch,
    ScopeMissing,
    GenerationMismatch,
}

#[derive(Default)]
pub struct RuntimeTokenService {
    tokens: DashMap<String, RuntimeTokenEntry>,
}

#[derive(Clone)]
struct RuntimeTokenEntry {
    token: String,
    claims: RuntimeTokenClaims,
    revoked_scopes: HashSet<RuntimeTokenScope>,
}

impl RuntimeTokenService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn issue(
        &self,
        user_id: impl Into<String>,
        conversation_id: impl Into<String>,
        session_generation: impl Into<String>,
        scopes: impl IntoIterator<Item = RuntimeTokenScope>,
    ) -> RuntimeTokenIssue {
        let user_id = user_id.into();
        let conversation_id = conversation_id.into();
        let session_generation = session_generation.into();
        let scopes = scopes.into_iter().collect::<HashSet<_>>();
        if let Some(existing) = self.existing_token(&user_id, &conversation_id, &session_generation, &scopes) {
            return existing;
        }
        let token = generate_token();
        let claims = RuntimeTokenClaims {
            user_id,
            conversation_id,
            scopes,
            issued_at: SystemTime::now(),
            session_generation,
        };
        self.invalidate_conversation(&claims.user_id, &claims.conversation_id);
        self.tokens.insert(
            token_hash(&token),
            RuntimeTokenEntry {
                token: token.clone(),
                claims: claims.clone(),
                revoked_scopes: HashSet::new(),
            },
        );
        RuntimeTokenIssue { token, claims }
    }

    fn existing_token(
        &self,
        user_id: &str,
        conversation_id: &str,
        session_generation: &str,
        scopes: &HashSet<RuntimeTokenScope>,
    ) -> Option<RuntimeTokenIssue> {
        self.tokens.iter().find_map(|entry| {
            let token_entry = entry.value();
            let claims = &token_entry.claims;
            if claims.user_id == user_id
                && claims.conversation_id == conversation_id
                && claims.session_generation == session_generation
                && scopes.is_subset(&claims.scopes)
            {
                // Match the original grant so a build-options refresh reuses
                // the live process token without restoring revoked capabilities.
                let mut effective = claims.clone();
                effective
                    .scopes
                    .retain(|scope| !token_entry.revoked_scopes.contains(scope));
                Some(RuntimeTokenIssue {
                    token: token_entry.token.clone(),
                    claims: effective,
                })
            } else {
                None
            }
        })
    }

    pub fn validate(
        &self,
        raw_token: Option<&str>,
        user_id: &str,
        conversation_id: &str,
        scope: RuntimeTokenScope,
        session_generation: &str,
    ) -> Result<RuntimeTokenClaims, RuntimeTokenError> {
        let raw_token = raw_token
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or(RuntimeTokenError::Missing)?;
        let Some(entry) = self.tokens.get(&token_hash(raw_token)) else {
            return Err(RuntimeTokenError::Unknown);
        };
        let mut claims = entry.value().claims.clone();
        claims
            .scopes
            .retain(|scope| !entry.value().revoked_scopes.contains(scope));
        drop(entry);
        if claims.user_id != user_id {
            return Err(RuntimeTokenError::UserMismatch);
        }
        if claims.conversation_id != conversation_id {
            return Err(RuntimeTokenError::ConversationMismatch);
        }
        if !claims.scopes.contains(&scope) {
            return Err(RuntimeTokenError::ScopeMissing);
        }
        if claims.session_generation != session_generation {
            return Err(RuntimeTokenError::GenerationMismatch);
        }
        Ok(claims)
    }

    pub fn invalidate_conversation(&self, user_id: &str, conversation_id: &str) {
        self.tokens
            .retain(|_, entry| !(entry.claims.user_id == user_id && entry.claims.conversation_id == conversation_id));
    }

    pub fn invalidate_conversation_id(&self, conversation_id: &str) {
        self.tokens
            .retain(|_, entry| entry.claims.conversation_id != conversation_id);
    }

    pub fn invalidate_generation(&self, conversation_id: &str, session_generation: &str) {
        self.tokens.retain(|_, claims| {
            !(claims.claims.conversation_id == conversation_id
                && claims.claims.session_generation == session_generation)
        });
    }

    /// Revoke only the requested capability for this user. A running process
    /// may share this token between search, team and helper tools; changing
    /// cloud credentials must not revoke its unrelated local capabilities.
    /// Remove entries once no capabilities remain.
    pub fn invalidate_user_scope(&self, user_id: &str, scope: RuntimeTokenScope) {
        self.tokens.retain(|_, entry| {
            if entry.claims.user_id != user_id {
                return true;
            }
            entry.revoked_scopes.insert(scope);
            entry
                .claims
                .scopes
                .iter()
                .any(|scope| !entry.revoked_scopes.contains(scope))
        });
    }
}

fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom(&mut bytes).expect("OS random source must be available");
    hex::encode(bytes)
}

fn token_hash(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
#[path = "runtime_token_test.rs"]
mod tests;
