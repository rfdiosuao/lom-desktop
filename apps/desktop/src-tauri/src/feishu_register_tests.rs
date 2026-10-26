use super::*;
use serde_json::json;

#[test]
fn feishu_06_one_scan_shows_the_official_page_for_the_registration_code() {
    let b = parse_begin(
        &json!({ "device_code": "dc", "user_code": "YKF4-VT4R", "interval": 5, "expire_in": 600 }),
    )
    .unwrap();
    assert_eq!(
        b.url,
        "https://open.feishu.cn/page/cli?user_code=YKF4-VT4R&lpv=1.0.97&ocv=1.0.97&from=cli"
    );
    assert_eq!((b.interval, b.expires_in), (5, 600));
    assert!(
        parse_begin(&json!({ "error": "invalid_request", "error_description": "bad" })).is_err()
    );
    assert!(parse_begin(&json!({ "device_code": "dc", "user_code": "A&b=c" })).is_err());
}

#[test]
fn feishu_06_the_scan_result_carries_the_app_and_its_owner() {
    let done = json!({ "client_id": "cli_a", "client_secret": "s3cr3t", "user_info": { "open_id": "ou_me", "tenant_brand": "feishu" } });
    assert_eq!(
        parse_poll(&done, "feishu"),
        Poll::Done {
            app_id: "cli_a".into(),
            secret: "s3cr3t".into(),
            owner: "ou_me".into(),
            brand: "feishu"
        }
    );
    assert_eq!(
        parse_poll(&json!({ "error": "authorization_pending" }), "feishu"),
        Poll::Pending
    );
    assert_eq!(
        parse_poll(&json!({ "error": "slow_down" }), "feishu"),
        Poll::SlowDown
    );
    assert_eq!(
        parse_poll(
            &json!({ "error": "authorization_pending", "user_info": { "tenant_brand": "lark" } }),
            "feishu"
        ),
        Poll::SwitchBrand("lark")
    );
    assert!(
        matches!(parse_poll(&json!({ "error": "access_denied" }), "feishu"), Poll::Failed(e) if e.contains("denied"))
    );
    assert!(
        matches!(parse_poll(&json!({ "error": "expired_token" }), "feishu"), Poll::Failed(e) if e.contains("expired"))
    );
    // 没有扫码人就不能认定主人
    assert!(matches!(
        parse_poll(
            &json!({ "client_id": "cli_a", "client_secret": "s" }),
            "feishu"
        ),
        Poll::Failed(_)
    ));
}

#[test]
fn feishu_06_the_owner_is_remembered_privately_and_cleared_on_disconnect() {
    let dir = std::env::temp_dir().join(format!("lom-feishu-06-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    assert_eq!(read_owner(&dir), None);
    write_owner(&dir, "ou_me").unwrap();
    assert_eq!(read_owner(&dir).as_deref(), Some("ou_me"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(dir.join(OWNER_FILE))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
    clear_owner(&dir);
    assert_eq!(read_owner(&dir), None);
    std::fs::remove_dir_all(dir).unwrap();
}
