use super::*;

#[test]
fn plugin_api_01_discovery_lists_every_extension_point_as_reserved() {
    let host = discover();
    let kinds: Vec<_> = host.extensions.iter().map(|e| e.kind).collect();
    assert_eq!(kinds, EXTENSION_KINDS.to_vec(), "十类扩展点一个都不能省略");
    for extension in &host.extensions {
        assert_eq!(extension.status, SupportStatus::Reserved);
        assert!(
            extension.api_versions.is_empty(),
            "reserved 不报扩展 API 版本"
        );
        assert!(
            extension.verified_matrix_refs.is_empty(),
            "没有任何兼容矩阵单元通过验收"
        );
    }
    assert_eq!(host.services.len(), HOST_SERVICES.len());
    assert!(host
        .services
        .iter()
        .all(|s| s.status == SupportStatus::Reserved));
    assert_eq!(host.methods.len(), HOST_METHODS.len());
    assert!(host
        .methods
        .iter()
        .all(|m| m.status == SupportStatus::Reserved));
}

#[test]
fn plugin_api_01_discovery_reports_discovery_only_host_api_and_no_runtime() {
    let host = discover();
    assert_eq!(host.protocol_versions, vec!["lom.plugin.v1alpha1"]);
    assert_eq!(
        host.host_api_versions,
        vec!["0.1.0"],
        "按 engine ^1.0.0 写的包在当前宿主上应协商失败"
    );
    assert!(
        host.execution_levels.is_empty(),
        "插件宿主没有分发，不能声称任何运行等级"
    );
    assert!(host.platform.contains('-'));
}

#[test]
fn plugin_api_01_discovery_json_uses_proto_json_field_names() {
    let value = serde_json::to_value(discover()).unwrap();
    for key in [
        "protocolVersions",
        "hostApiVersions",
        "platform",
        "executionLevels",
        "extensions",
        "services",
        "methods",
    ] {
        assert!(value.get(key).is_some(), "缺少字段 {key}");
    }
    assert!(value.get("limits").is_none(), "没有可用执行链时不报限额");
    assert_eq!(value["extensions"][0]["status"], "SUPPORT_STATUS_RESERVED");
    assert_eq!(
        value["extensions"][0]["verifiedMatrixRefs"],
        serde_json::json!([])
    );
}

#[test]
fn plugin_api_01_reserved_methods_never_return_empty_success() {
    for method in HOST_METHODS {
        let error = request(method).expect_err("reserved 方法不能返回成功");
        let lom = error.to_lom_error();
        assert_eq!(lom.code, "plugin.capability_unsupported", "{method}");
        assert!(!lom.retryable, "{method} 的拒绝不可重试");
        assert_eq!(lom.detail.get("method").map(String::as_str), Some(method));
    }
}

#[test]
fn plugin_api_01_request_and_discovery_agree_on_every_method() {
    // 一张表两处用：discover 说 reserved 的方法，request 必须以 capability_unsupported 拒绝
    for support in discover().methods {
        let outcome = request(support.method);
        match support.status {
            SupportStatus::Reserved => assert_eq!(
                outcome.map_err(|e| e.code()),
                Err("plugin.capability_unsupported"),
                "{}",
                support.method
            ),
        }
    }
}

#[test]
fn plugin_api_01_unknown_method_is_a_negotiation_failure_not_success() {
    let long = "X".repeat(500);
    for method in [
        "",
        "HOST_METHOD_UNSPECIFIED",
        "DiscoverHost",
        "install",
        long.as_str(),
    ] {
        let lom = request(method)
            .expect_err("未知方法不能返回成功")
            .to_lom_error();
        assert_eq!(lom.code, "plugin.api_incompatible", "{method}");
        assert!(!lom.retryable);
        assert!(lom.detail["method"].chars().count() <= 64, "回显必须截断");
    }
}

#[test]
fn plugin_api_01_tauri_command_returns_lom_error_shape() {
    let error =
        plugin_host_request("HOST_METHOD_INSTALL_PACKAGE".into()).expect_err("安装尚未实现");
    let value = serde_json::to_value(error).unwrap();
    assert_eq!(value["code"], "plugin.capability_unsupported");
    assert_eq!(value["retryable"], false);
    assert_eq!(value["messageKey"], "plugin.capabilityUnsupported");
    assert_eq!(value["detail"]["protocolVersion"], "lom.plugin.v1alpha1");
}
