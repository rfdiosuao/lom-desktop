mod parser;
mod store;
mod titles;
pub use store::HistoryStore;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum HistoryError {
    #[error("history.io_failed")]
    Io(#[from] std::io::Error),
    #[error("history.invalid_archive")]
    Json(#[from] serde_json::Error),
    #[error("history.{0}")]
    Invalid(&'static str),
}
#[cfg(test)]
mod tests;
