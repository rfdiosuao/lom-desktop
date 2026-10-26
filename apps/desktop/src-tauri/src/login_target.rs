//! HEANG hosted registration and social login, retaining the outer OIDC PKCE query.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;

use crate::login::enc;

#[derive(Deserialize)]
struct ApplicationResponse {
    data: Option<Application>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Application {
    name: String,
    client_id: String,
    providers: Vec<ProviderItem>,
}
#[derive(Deserialize)]
struct ProviderItem {
    provider: Option<Provider>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Provider {
    name: String,
    client_id: String,
    #[serde(rename = "type")]
    kind: String,
}

pub fn target(
    authorize: &str,
    issuer: &str,
    client_id: &str,
    method: &str,
) -> Result<String, String> {
    match method {
        "login" => Ok(authorize.to_owned()),
        "register" => {
            let query = authorize
                .split_once('?')
                .ok_or("auth.invalid_authorize_url")?
                .1;
            Ok(format!(
                "{}/signup/oauth/authorize?{query}",
                issuer.trim_end_matches('/')
            ))
        }
        "google" | "github" => {
            let response: ApplicationResponse = ureq::get(&format!(
                "{}/api/get-application?id=admin/lom-desktop",
                issuer.trim_end_matches('/')
            ))
            .timeout(std::time::Duration::from_secs(20))
            .call()
            .map_err(|_| "auth.provider_unavailable: 无法读取登录方式，请稍后重试")?
            .into_json()
            .map_err(|_| "auth.provider_invalid: 登录方式配置无效")?;
            let app = response
                .data
                .ok_or("auth.application_missing: 登录应用不存在")?;
            if app.client_id != client_id {
                return Err("auth.client_mismatch: 登录应用配置不匹配".into());
            }
            let kind = if method == "google" {
                "Google"
            } else {
                "GitHub"
            };
            let provider = app
                .providers
                .into_iter()
                .filter_map(|p| p.provider)
                .find(|p| p.kind == kind)
                .ok_or("auth.provider_missing: 尚未配置此登录方式")?;
            social_url(authorize, issuer, &app.name, &provider)
        }
        _ => Err("auth.invalid_method: 不支持的登录方式".into()),
    }
}

fn social_url(
    authorize: &str,
    issuer: &str,
    app: &str,
    provider: &Provider,
) -> Result<String, String> {
    let (endpoint, scope) = match provider.kind.as_str() {
        "Google" => (
            "https://accounts.google.com/o/oauth2/v2/auth",
            "openid profile email",
        ),
        "GitHub" => (
            "https://github.com/login/oauth/authorize",
            "read:user user:email",
        ),
        _ => return Err("auth.invalid_provider".into()),
    };
    let query = authorize
        .split_once('?')
        .ok_or("auth.invalid_authorize_url")?
        .1;
    // Casdoor's callback decodes this envelope and forwards the original state + PKCE challenge.
    // 'signup' permits first-time social users to register; it does not link existing identities.
    let envelope = format!(
        "?{query}&application={}&provider={}&method=signup",
        enc(app),
        enc(&provider.name)
    );
    let state = STANDARD.encode(envelope);
    Ok(format!(
        "{endpoint}?client_id={}&redirect_uri={}&scope={}&response_type=code&state={}",
        enc(&provider.client_id),
        enc(&format!("{}/callback", issuer.trim_end_matches('/'))),
        enc(scope),
        enc(&state)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    const AUTH: &str = "https://account.example.invalid/login/oauth/authorize?client_id=lom&state=random&code_challenge=proof&code_challenge_method=S256&redirect_uri=http%3A%2F%2F127.0.0.1%3A1234%2Fcallback";
    #[test]
    fn s04_01_registration_keeps_pkce_and_callback() {
        assert_eq!(
            target(AUTH, "https://account.example.invalid", "lom", "register").unwrap(),
            AUTH.replace("/login/", "/signup/")
        );
        assert_eq!(
            target(AUTH, "https://account.example.invalid", "lom", "login").unwrap(),
            AUTH
        );
        assert!(target(AUTH, "https://account.example.invalid", "lom", "unknown").is_err());
    }
    #[test]
    fn s04_01_social_routes_keep_original_state_and_only_profile_scopes() {
        for kind in ["Google", "GitHub"] {
            let provider = Provider {
                name: format!("provider-lom-{}", kind.to_lowercase()),
                client_id: "public-client".into(),
                kind: kind.into(),
            };
            let url = social_url(
                AUTH,
                "https://account.example.invalid",
                "lom-desktop",
                &provider,
            )
            .unwrap();
            let query = url.split_once('?').unwrap().1;
            let encoded = crate::login::query_param(query, "state").unwrap();
            let envelope = String::from_utf8(STANDARD.decode(encoded).unwrap()).unwrap();
            assert!(envelope.starts_with(&format!("?{}", AUTH.split_once('?').unwrap().1)));
            assert!(envelope.ends_with("&method=signup"));
            assert_eq!(
                crate::login::query_param(query, "redirect_uri").unwrap(),
                "https://account.example.invalid/callback"
            );
            assert!(!url.contains("client_secret"));
        }
    }
}
