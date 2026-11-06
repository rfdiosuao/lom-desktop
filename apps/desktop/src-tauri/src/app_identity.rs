//! INSTALL-PATH-01：安装目录和应用包名只用英文（Windows `…\Lom\`、macOS `Lom.app`），
//! 用户看到的名字仍是「麓鸣 Lom」。社区版使用独立标识符，避免读取商业版的数据和钥匙串。

use tauri::{Context, Runtime};

/// 窗口标题、系统菜单、开始菜单和启动台里显示的名字
pub const DISPLAY_NAME: &str = "麓鸣 Lom";

/// macOS 的打包名是 `Lom`；运行时的应用名（系统菜单里的“关于／隐藏／退出”）仍用显示名，
/// 与 0.3.8 及以前一致。Windows 的打包名本来就是显示名，这里不改变任何东西。
pub fn with_display_name<R: Runtime>(mut context: Context<R>) -> Context<R> {
    context.package_info_mut().name = DISPLAY_NAME.to_owned();
    context
}

#[cfg(test)]
mod tests {
    use super::DISPLAY_NAME;
    use serde_json::Value;
    use std::path::Path;

    fn config(text: &str) -> Value {
        serde_json::from_str(text).unwrap_or(Value::Null)
    }

    fn base() -> Value {
        config(include_str!("../tauri.conf.json"))
    }

    fn mac() -> Value {
        config(include_str!("../tauri.macos.conf.json"))
    }

    fn windows() -> Value {
        config(include_str!("../tauri.windows.conf.json"))
    }

    /// Tauri 按平台合并配置：平台文件里有的字段覆盖主配置
    fn product_name(platform: &Value) -> String {
        let base = base();
        platform["productName"]
            .as_str()
            .or_else(|| base["productName"].as_str())
            .unwrap_or_default()
            .to_owned()
    }

    fn strings_file(path: &Path) -> Vec<(String, String)> {
        let text = std::fs::read_to_string(path).unwrap_or_default();
        text.lines()
            .filter_map(|line| {
                let (key, value) = line.trim().strip_suffix(';')?.split_once(" = ")?;
                Some((key.trim_matches('"').into(), value.trim_matches('"').into()))
            })
            .collect()
    }

    #[test]
    fn install_path_01_mac_bundle_name_is_ascii_without_spaces() {
        let name = product_name(&mac());
        assert_eq!(name, "Lom");
        assert!(name.is_ascii() && !name.contains(char::is_whitespace));
    }

    #[test]
    fn install_path_01_mac_shows_display_name_in_every_bundled_language() {
        let files = mac()["bundle"]["macOS"]["files"].clone();
        let files = files.as_object().cloned().unwrap_or_default();
        let languages: Vec<&str> = files
            .keys()
            .filter_map(|target| target.strip_prefix("Resources/"))
            .filter_map(|target| target.strip_suffix(".lproj/InfoPlist.strings"))
            .collect();
        assert_eq!(languages, ["en", "zh-Hans"]);
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        for source in files.values() {
            let entries = strings_file(&root.join(source.as_str().unwrap_or_default()));
            for key in ["CFBundleDisplayName", "CFBundleName"] {
                let value = entries.iter().find(|(k, _)| k == key).map(|(_, v)| v);
                assert_eq!(
                    value.map(String::as_str),
                    Some(DISPLAY_NAME),
                    "{source} {key}"
                );
            }
        }
    }

    #[test]
    fn install_path_01_windows_keeps_registered_names_and_hooks_install_dir() {
        // 卸载项、注册表键和快捷方式名按产品名生成，保持不变老用户才能原位升级
        assert_eq!(product_name(&windows()), DISPLAY_NAME);
        let hooks = windows()["bundle"]["windows"]["nsis"]["installerHooks"].clone();
        let hooks = Path::new(env!("CARGO_MANIFEST_DIR")).join(hooks.as_str().unwrap_or_default());
        assert!(
            hooks.is_file(),
            "missing installer hooks {}",
            hooks.display()
        );
    }

    #[test]
    fn install_path_01_windows_cleanup_list_matches_installed_files() {
        // windows/installer-hooks.nsh 迁移后按这份清单删除旧目录里的文件；
        // 这里变了，钩子里的删除清单要一起改，否则旧目录会残留文件
        assert_eq!(
            base()["bundle"]["externalBin"],
            serde_json::json!(["binaries/aioncore", "binaries/lark-cli"])
        );
        assert_eq!(
            base()["bundle"]["resources"],
            serde_json::json!([
                "licenses/lark-cli-LICENSE",
                "licenses/personal-templates-NOTICE"
            ])
        );
    }

    #[test]
    fn install_path_01_data_and_keychain_identity_unchanged() {
        // 应用数据目录、WebView 数据和钥匙串服务名都由标识符决定
        assert_eq!(base()["identifier"], "org.lom.community.desktop");
        assert_eq!(base()["mainBinaryName"], "Lom");
    }

    #[test]
    fn install_path_01_window_title_is_display_name() {
        assert_eq!(base()["app"]["windows"][0]["title"], DISPLAY_NAME);
        assert_eq!(base()["bundle"]["shortDescription"], DISPLAY_NAME);
    }
}
