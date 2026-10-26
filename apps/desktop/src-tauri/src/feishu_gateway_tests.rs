use super::*;

const OWNER: &str = "ou_owner";

fn event(chat_type: &str, sender: &str, sender_type: &str, content: &str) -> String {
    serde_json::json!({
        "type": "im.message.receive_v1", "message_id": "om_1", "chat_id": "oc_1",
        "chat_type": chat_type, "sender_id": sender, "sender_type": sender_type,
        "message_type": "text", "content": content,
    })
    .to_string()
}

#[test]
fn feishu_02_only_the_authorizing_user_is_read_from_auth_status() {
    let status = r#"{"appId":"cli_a","identity":"user","identities":{"user":{"openId":"ou_owner","available":true},"bot":{}}}"#;
    assert_eq!(owner_open_id(status).as_deref(), Some(OWNER));
    let bot_only =
        r#"{"appId":"cli_a","identity":"bot","identities":{"user":{"openId":"ou_owner"}}}"#;
    assert_eq!(owner_open_id(bot_only), None);
    assert_eq!(owner_open_id(r#"{"ok":false}"#), None);
}

#[test]
fn feishu_02_only_the_owners_private_messages_reach_the_assistant() {
    let mine = inbound(&event("p2p", OWNER, "user", " 帮我看下日程 "), OWNER).unwrap();
    assert_eq!(
        mine,
        FeishuInbound {
            account: String::new(),
            assistant_id: String::new(),
            app_id: String::new(),
            generation: 0,
            message_id: "om_1".into(),
            chat_id: "oc_1".into(),
            text: "帮我看下日程".into()
        }
    );
    assert!(inbound(&event("group", OWNER, "user", "hi"), OWNER).is_none());
    assert!(inbound(&event("p2p", "ou_stranger", "user", "hi"), OWNER).is_none());
    assert!(inbound(&event("p2p", OWNER, "app", "hi"), OWNER).is_none());
    assert!(inbound(&event("p2p", OWNER, "user", "  "), OWNER).is_none());
    assert!(inbound("[event] ready event_key=im.message.receive_v1", OWNER).is_none());
}

#[test]
fn feishu_02_replies_may_only_call_reply_and_card_endpoints() {
    assert!(allowed_api(
        "POST",
        "/open-apis/im/v1/messages/om_abc/reply"
    ));
    assert!(allowed_api("POST", "/open-apis/cardkit/v1/cards"));
    assert!(allowed_api(
        "PUT",
        "/open-apis/cardkit/v1/cards/7a1/elements/answer/content"
    ));
    assert!(allowed_api(
        "PATCH",
        "/open-apis/cardkit/v1/cards/7a1/settings"
    ));
    assert!(!allowed_api("GET", "/open-apis/cardkit/v1/cards"));
    assert!(!allowed_api("POST", "/open-apis/im/v1/messages"));
    assert!(!allowed_api(
        "POST",
        "/open-apis/im/v1/messages/om_a/forward"
    ));
    assert!(!allowed_api(
        "POST",
        "/open-apis/im/v1/messages/om_a/x/reply"
    ));
    assert!(!allowed_api("POST", "/open-apis/drive/v1/files"));
    assert!(!allowed_api(
        "POST",
        "/open-apis/cardkit/v1/cards/../../drive"
    ));
    assert!(!allowed_api("POST", "/open-apis/cardkit/v1/cards?x=1"));
}

#[test]
fn feishu_05_the_typing_reaction_can_be_added_and_removed_only_on_a_message() {
    assert!(allowed_api(
        "POST",
        "/open-apis/im/v1/messages/om_abc/reactions"
    ));
    assert!(allowed_api(
        "DELETE",
        "/open-apis/im/v1/messages/om_abc/reactions/ZCaCIjUBVVWSrm5L"
    ));
    assert!(!allowed_api("DELETE", "/open-apis/im/v1/messages/om_abc"));
    assert!(!allowed_api(
        "DELETE",
        "/open-apis/im/v1/messages/om_abc/reactions/"
    ));
    assert!(!allowed_api("DELETE", "/open-apis/cardkit/v1/cards/7a1"));
    assert!(!allowed_api(
        "PUT",
        "/open-apis/im/v1/messages/om_abc/reactions"
    ));
    assert!(!allowed_api(
        "GET",
        "/open-apis/im/v1/messages/om_abc/reactions"
    ));
}

#[test]
fn feishu_multi_inbound_receipt_identifies_its_connection() {
    let message = inbound(&event("p2p", OWNER, "user", "hello"), OWNER)
        .unwrap()
        .scoped("account", "assistant-b", "cli_b", 7);
    let value = serde_json::to_value(message).unwrap();
    assert_eq!(value["account"], "account");
    assert_eq!(value["assistant_id"], "assistant-b");
    assert_eq!(value["app_id"], "cli_b");
    assert_eq!(value["generation"], 7);
    assert_eq!(value["message_id"], "om_1");
}
