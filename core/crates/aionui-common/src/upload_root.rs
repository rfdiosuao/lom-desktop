//! Managed upload directory under the system temp dir (Lom patch P4).
//!
//! Upstream hard-codes `<tmp>/aionui`. That path is shown to the agent with
//! every attached file, so an embedding product names it after itself by
//! setting `LOM_TEMP_NAMESPACE` (lowercase letters, digits and `-`, at most
//! 32 chars). Unset or invalid values keep the upstream name, so behavior is
//! unchanged for upstream builds.

use std::path::PathBuf;

const DEFAULT_NAMESPACE: &str = "aionui";

fn namespace(value: Option<&str>) -> &str {
    match value {
        Some(v)
            if !v.is_empty()
                && v.len() <= 32
                && v.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') =>
        {
            v
        }
        _ => DEFAULT_NAMESPACE,
    }
}

/// `<tmp>/<namespace>`: where uploaded chat files live and where `Upload`
/// file refs are validated. Every caller must use this one function.
pub fn upload_root() -> PathBuf {
    let value = std::env::var("LOM_TEMP_NAMESPACE").ok();
    std::env::temp_dir().join(namespace(value.as_deref()))
}

#[cfg(test)]
mod tests {
    use super::namespace;

    #[test]
    fn accepts_only_safe_names() {
        assert_eq!(namespace(Some("lom")), "lom");
        assert_eq!(namespace(Some("lom-2")), "lom-2");
        assert_eq!(namespace(None), "aionui");
        for bad in ["", "Lom", "../x", "a/b", "x y", &"a".repeat(33)] {
            assert_eq!(namespace(Some(bad)), "aionui", "{bad:?}");
        }
    }
}
