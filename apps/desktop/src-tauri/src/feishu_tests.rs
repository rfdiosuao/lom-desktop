use super::*;

#[test]
fn feishu_status_distinguishes_unconfigured_bot_only_and_authorized() {
    let none = r#"{"ok":false,"error":{"type":"config","subtype":"not_configured"}}"#;
    assert_eq!(
        parse_status(none),
        FeishuStatus {
            configured: false,
            app_id: None,
            authorized: false,
            auth: None,
            generation: 0,
            connected: false
        }
    );
    let bot = r#"{"appId":"cli_a1","brand":"feishu","identity":"bot"}"#;
    assert_eq!(
        parse_status(bot),
        FeishuStatus {
            configured: true,
            app_id: Some("cli_a1".into()),
            authorized: false,
            auth: None,
            generation: 0,
            connected: false
        }
    );
    let user = r#"{"appId":"cli_a1","brand":"feishu","identity":"user"}"#;
    assert!(parse_status(user).authorized);
    assert!(parse_status(user).connected);
    assert_eq!(
        parse_status("not json"),
        FeishuStatus {
            configured: false,
            app_id: None,
            authorized: false,
            auth: None,
            generation: 0,
            connected: false
        }
    );
}

#[test]
fn feishu_reads_the_authorization_link_and_device_code() {
    let flat = r#"{"verification_url":"https://accounts.feishu.cn/oauth/v1/device/verify?code=AB","device_code":"dc1"}"#;
    assert_eq!(
        parse_login_start(flat),
        Some((
            "https://accounts.feishu.cn/oauth/v1/device/verify?code=AB".into(),
            "dc1".into()
        ))
    );
    let wrapped = r#"{"ok":true,"data":{"verification_url":"https://accounts.feishu.cn/x","device_code":"dc2"}}"#;
    assert_eq!(
        parse_login_start(wrapped).map(|(_, c)| c),
        Some("dc2".into())
    );
    assert_eq!(
        parse_login_start(r#"{"verification_url":"https://evil.example/x","device_code":"d"}"#),
        None
    );
    assert_eq!(parse_login_start(r#"{"ok":false}"#), None);
}
