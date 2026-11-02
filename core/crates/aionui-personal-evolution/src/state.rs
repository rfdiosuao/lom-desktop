use serde::{Deserialize, Serialize};
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Scope {
    pub account: String,
    pub assistant: String,
}
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Source {
    Reflection,
    Correction,
}
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Target {
    User,
    Tools,
    WorkMethods,
    SoulAdjustment,
}
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Effect {
    Preference,
    Method,
    Personality,
    Confirmation,
    Permission,
    Credential,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Lesson {
    pub key: String,
    pub cue: String,
    pub content: String,
    pub evidence: String,
    pub source: Source,
    pub target: Target,
    pub effect: Effect,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Version {
    pub number: u64,
    pub lessons: Vec<Lesson>,
    pub corrected: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Record {
    pub revision: u64,
    pub reason: String,
    pub version: Version,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub scope: Scope,
    pub records: Vec<Record>,
}
#[derive(Debug, thiserror::Error)]
pub enum EvolutionError {
    #[error("personal.evolution_invalid")]
    Invalid,
    #[error("personal.evolution_blocked")]
    Blocked,
    #[error("personal.evolution_correction_priority")]
    CorrectionPriority,
    #[error("personal.evolution_conflict")]
    Conflict,
    #[error("personal.evolution_missing_version")]
    MissingVersion,
    #[error("personal.evolution_storage")]
    Storage,
}
