//! PLUGIN-API-01：插件宿主能力发现（只读）与统一拒绝入口。
//!
//! 设计（PLUGIN-DSH-01）把 DiscoverHost 放在 Tauri 管理控制面：插件宿主还没有随应用分发，
//! 所以这里如实报告——宿主 API 只有发现接口（0.1.0），十类扩展点、六个公共服务和全部宿主方法都是 reserved。
//! 任何管理或调用请求在实现前一律返回 `plugin.capability_unsupported`，不返回空成功。
//!
//! 字段名与取值和 `lom.plugin.v1alpha1` 的 proto JSON 映射一致（`HostDescriptor`、`LomError`），
//! 以后换成生成类型只是机械替换。前端与外壳之间是进程内调用，按 ADR 0003 不走 proto。

use serde::Serialize;
use std::collections::BTreeMap;

pub const PROTOCOL_VERSION: &str = "lom.plugin.v1alpha1";
/// 0.x 表示只有发现接口；第一个扩展点实现后才发布 1.0.0。
pub const HOST_API_VERSION: &str = "0.1.0";

/// 十类扩展点（proto 枚举 `ExtensionKind` 的取值名）。
pub const EXTENSION_KINDS: [&str; 10] = [
    "EXTENSION_KIND_TOOL",
    "EXTENSION_KIND_SERVICE",
    "EXTENSION_KIND_EVENT_SOURCE",
    "EXTENSION_KIND_CHANNEL",
    "EXTENSION_KIND_MODEL",
    "EXTENSION_KIND_EXECUTOR",
    "EXTENSION_KIND_AUTOMATION",
    "EXTENSION_KIND_UI",
    "EXTENSION_KIND_STORAGE",
    "EXTENSION_KIND_SANDBOX",
];

/// 六个 SDK 公共服务（proto 枚举 `HostService`）。
pub const HOST_SERVICES: [&str; 6] = [
    "HOST_SERVICE_LOGGER",
    "HOST_SERVICE_NETWORK",
    "HOST_SERVICE_FILESYSTEM",
    "HOST_SERVICE_SECRETS",
    "HOST_SERVICE_SCHEDULER",
    "HOST_SERVICE_ARTIFACTS",
];

/// 宿主方法（proto 枚举 `HostMethod`）。DiscoverHost 本身不在其中，它总是可用。
pub const HOST_METHODS: [&str; 26] = [
    "HOST_METHOD_LIST_PACKAGES",
    "HOST_METHOD_INSPECT_PACKAGE",
    "HOST_METHOD_INSTALL_PACKAGE",
    "HOST_METHOD_UPDATE_PACKAGE",
    "HOST_METHOD_UNINSTALL_PACKAGE",
    "HOST_METHOD_CREATE_INSTANCE",
    "HOST_METHOD_GET_INSTANCE",
    "HOST_METHOD_LIST_INSTANCES",
    "HOST_METHOD_CONFIGURE_INSTANCE",
    "HOST_METHOD_SET_ENABLED",
    "HOST_METHOD_REMOVE_INSTANCE",
    "HOST_METHOD_WATCH_INSTANCES",
    "HOST_METHOD_SET_GRANT",
    "HOST_METHOD_SET_CHANNEL_GRANTS",
    "HOST_METHOD_LIST_CHANNEL_GRANTS",
    "HOST_METHOD_GET_OPERATION",
    "HOST_METHOD_GET_OPERATION_BY_KEY",
    "HOST_METHOD_WATCH_OPERATIONS",
    "HOST_METHOD_LIST_CAPABILITIES",
    "HOST_METHOD_INVOKE_CAPABILITY",
    "HOST_METHOD_CANCEL_CALL",
    "HOST_METHOD_GET_CALL",
    "HOST_METHOD_PUBLISH_EVENT",
    "HOST_METHOD_SUBSCRIBE_EVENTS",
    "HOST_METHOD_ACK_EVENT",
    "HOST_METHOD_POST_PERSONAL_MESSAGE",
];

/// 实现状态。现在只有 reserved；第一个能力真正实现时再加 implemented，并同步 IDL 与兼容矩阵。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum SupportStatus {
    #[serde(rename = "SUPPORT_STATUS_RESERVED")]
    Reserved,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionSupport {
    pub kind: &'static str,
    pub api_versions: Vec<&'static str>,
    pub status: SupportStatus,
    pub verified_matrix_refs: Vec<&'static str>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceSupport {
    pub service: &'static str,
    pub api_versions: Vec<&'static str>,
    pub status: SupportStatus,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MethodSupport {
    pub method: &'static str,
    pub status: SupportStatus,
}

/// `lom.plugin.v1alpha1.HostDescriptor`。没有可用执行链，所以不报 limits、运行等级为空。
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostDescriptor {
    pub protocol_versions: Vec<&'static str>,
    pub host_api_versions: Vec<&'static str>,
    pub platform: String,
    pub execution_levels: Vec<&'static str>,
    pub extensions: Vec<ExtensionSupport>,
    pub services: Vec<ServiceSupport>,
    pub methods: Vec<MethodSupport>,
}

/// `lom.common.v1.LomError` 的 JSON 形状。
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LomError {
    pub code: &'static str,
    pub retryable: bool,
    pub message_key: &'static str,
    pub detail: BTreeMap<&'static str, String>,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum PluginHostError {
    /// 方法存在但 reserved。不可重试：换个时间也不会成功。
    #[error("plugin host method is reserved: {method}")]
    CapabilityUnsupported { method: &'static str },
    /// 方法不在 `lom.plugin.v1alpha1.HostMethod` 目录里（版本协商失败）。
    #[error("plugin host method is not part of {PROTOCOL_VERSION}")]
    UnknownMethod { method: String },
}

impl PluginHostError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::CapabilityUnsupported { .. } => "plugin.capability_unsupported",
            Self::UnknownMethod { .. } => "plugin.api_incompatible",
        }
    }

    pub fn to_lom_error(&self) -> LomError {
        let (message_key, method) = match self {
            Self::CapabilityUnsupported { method } => {
                ("plugin.capabilityUnsupported", (*method).to_owned())
            }
            Self::UnknownMethod { method } => ("plugin.apiIncompatible", method.clone()),
        };
        let mut detail = BTreeMap::new();
        detail.insert("method", method);
        detail.insert("protocolVersion", PROTOCOL_VERSION.to_owned());
        LomError {
            code: self.code(),
            retryable: false,
            message_key,
            detail,
        }
    }
}

/// 只读能力发现。每次都从同一张表构造，不缓存运行状态。
pub fn discover() -> HostDescriptor {
    HostDescriptor {
        protocol_versions: vec![PROTOCOL_VERSION],
        host_api_versions: vec![HOST_API_VERSION],
        platform: platform(),
        execution_levels: Vec::new(),
        extensions: EXTENSION_KINDS
            .iter()
            .map(|kind| ExtensionSupport {
                kind,
                api_versions: Vec::new(),
                status: SupportStatus::Reserved,
                verified_matrix_refs: Vec::new(),
            })
            .collect(),
        services: HOST_SERVICES
            .iter()
            .map(|service| ServiceSupport {
                service,
                api_versions: Vec::new(),
                status: SupportStatus::Reserved,
            })
            .collect(),
        methods: HOST_METHODS
            .iter()
            .map(|method| MethodSupport {
                method,
                status: SupportStatus::Reserved,
            })
            .collect(),
    }
}

/// 所有管理与调用请求的唯一入口。截至 PLUGIN-API-01 没有任何方法实现，一律拒绝；
/// 实现某个方法时必须同时把它在 `discover()` 里改成 implemented，测试会核对两者一致。
pub fn request(method: &str) -> Result<serde_json::Value, PluginHostError> {
    let Some(known) = HOST_METHODS.iter().copied().find(|m| *m == method) else {
        // 回显前截断，避免把任意长输入写进错误细节
        return Err(PluginHostError::UnknownMethod {
            method: method.chars().take(64).collect(),
        });
    };
    Err(PluginHostError::CapabilityUnsupported { method: known })
}

/// 平台名与插件包 manifest 的 `platforms` 写法一致，例如 darwin-arm64、win32-x64。
fn platform() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        other => other,
    };
    format!("{os}-{arch}")
}

#[tauri::command]
pub fn plugin_host_discover() -> HostDescriptor {
    discover()
}

#[tauri::command]
pub fn plugin_host_request(method: String) -> Result<serde_json::Value, LomError> {
    request(&method).map_err(|error| {
        log::info!("plugin host request rejected: {} ({})", error.code(), error);
        error.to_lom_error()
    })
}

#[cfg(test)]
#[path = "plugin_host_tests.rs"]
mod tests;
