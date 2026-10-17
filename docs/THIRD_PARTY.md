# 第三方与来源说明

公开代码中的设计令牌、图标、Markdown 组件和基础窗口配置从 Lom 桌面代码中提取，并为独立发布移除了私有业务依赖；本地文档入口、受系统对话框约束的文件操作及发布检查为本次独立实现。

主要依赖包括 React / React DOM（MIT）、Tauri（MIT OR Apache-2.0）、Tauri dialog plugin（MIT OR Apache-2.0）、Vite / Vitest / TypeScript（参见相应软件包的许可证）、Rust serde 与 base64（MIT OR Apache-2.0）。准确依赖版本记录在 package-lock.json 和 src-tauri/Cargo.lock，各依赖的版权与许可证保持有效。

本说明针对公开源码；官方完整安装包可能包含其他独立组件，不由本仓库源码许可证一并授权。
