# 第三方与来源说明

公开代码中的设计令牌、图标、Markdown 组件和基础窗口配置从 Lom 桌面代码中提取，并为独立发布移除了私有业务依赖；本地文档入口、受系统对话框约束的文件操作及发布检查为本次独立实现。

主要依赖包括 React / React DOM（MIT）、Tauri（MIT OR Apache-2.0）、Tauri dialog plugin（MIT OR Apache-2.0）、Vite / Vitest / TypeScript（参见相应软件包的许可证）、Rust serde 与 base64（MIT OR Apache-2.0）。准确依赖版本记录在 package-lock.json 和 src-tauri/Cargo.lock，各依赖的版权与许可证保持有效。

本说明针对公开源码；官方完整安装包可能包含其他独立组件，不由本仓库源码许可证一并授权。

2026-10-19 增补：桌面按钮/选择/布局、圆形头像动效、双层技能上传菜单与本机 CLI 连接/原生启动外壳来自当前 Lom 桌面实现。提取时将私有状态、发现/上传业务替换为显式回调，只保留桌面本机协议；并新增组件预览、边界校验与测试。未复制手机、云端服务或商业执行内核代码。新增 Rust 依赖 getrandom 与 dirs 的许可证参见锁定软件包（MIT OR Apache-2.0）。
