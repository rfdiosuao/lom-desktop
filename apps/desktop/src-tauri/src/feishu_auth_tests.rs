use super::*;
const USER: &str =
    r#"{"appId":"cli_a","identity":"user","identities":{"user":{"openId":"ou_owner"}}}"#;
#[test]
fn feishu_08_completion_requires_matching_app_and_owner_even_after_zero_exit() {
    assert!(completion(Ok(USER.into()), "cli_a", Some("ou_owner"), &[]).is_ok());
    assert!(completion(Ok(USER.into()), "cli_b", Some("ou_owner"), &[]).is_err());
    assert!(completion(Ok(USER.into()), "cli_a", Some("ou_other"), &[]).is_err());
    assert!(completion(
        Ok(r#"{"appId":"cli_a","identity":"bot"}"#.into()),
        "cli_a",
        Some("ou_owner"),
        &[]
    )
    .unwrap_err()
    .contains("auth_not_saved"));
    assert!(
        completion(Err("failure".into()), "cli_a", Some("ou_owner"), &[])
            .unwrap_err()
            .contains("auth_status_failed")
    );
}
#[test]
fn feishu_08_saved_user_wins_over_cli_error_and_expiry_is_honest() {
    assert!(completion(
        Ok(USER.into()),
        "cli_a",
        Some("ou_owner"),
        &["admin restricted scope".into()]
    )
    .is_ok());
    assert!(completion(
        Ok("{}".into()),
        "cli_a",
        Some("ou_owner"),
        &["device expired".into()]
    )
    .unwrap_err()
    .contains("auth_expired"));
}
#[test]
fn feishu_08_sensitive_cli_lines_are_not_event_details() {
    for line in [
        "device_code=SECRET",
        "access_token SECRET",
        "{\"message\":\"bad\"}",
        "Bearer SECRET",
    ] {
        assert_eq!(safe_detail(line), None);
    }
    assert_eq!(
        safe_detail("[warn] admin restricted scope docs:read"),
        Some("admin restricted scope docs:read".into())
    );
    assert_eq!(
        safe_detail("see https://accounts.feishu.cn/?x=secret"),
        None
    );
}

#[test]
fn feishu_08_a_connection_without_a_saved_owner_takes_the_verified_authorizer() {
    // FEISHU-06 之前两次扫码接入的没有主人记录：授权核实后以授权人为主人
    assert_eq!(
        completion(Ok(USER.into()), "cli_a", None, &[]).unwrap(),
        "ou_owner"
    );
    assert!(completion(Ok(USER.into()), "cli_b", None, &[]).is_err());
    assert!(completion(
        Ok(r#"{"appId":"cli_a","identity":"bot"}"#.into()),
        "cli_a",
        None,
        &[]
    )
    .is_err());
}
