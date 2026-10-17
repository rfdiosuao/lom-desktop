# 开发桌面外壳

这是可独立运行的本地文档工作台，使用 Tauri 2、React 19 和 TypeScript。没有账号要求、远程接口、模型请求或后端进程。

## 本地运行

需要 Node.js 24、npm、Rust 1.95，以及操作系统对应的 [Tauri 构建依赖](https://v2.tauri.app/start/prerequisites/)。Windows 需 MSVC 工具链及 WebView2；macOS 需 Xcode Command Line Tools。

```bash
git clone https://github.com/rfdiosuao/lom-desktop.git
cd lom-desktop
npm ci
npm run tauri -- dev
```

浏览器预览使用 `npm run dev`，访问 `http://127.0.0.1:1420`。网页模式支持文本编辑、实时预览和导出；系统文件选择功能需要桌面模式。

## 检查与编译

```bash
npm test
npm run build
npm run audit:public
cargo test --manifest-path src-tauri/Cargo.toml
# macOS
npm run tauri -- build
# Windows
npm run tauri -- build --bundles nsis
```

构建结果位于 `src-tauri/target/release/bundle/`。编译得到的是 **Lom Desktop 本地工作台**，不是 Release 中的官方完整版。

## 可复用的部分

- `src/components/`：Markdown 安全渲染、图标、按钮、圆形加载状态。
- `src/styles/`：明暗主题与设计令牌。
- `src/core/documents.ts`：本地文件 UI 适配。
- `src-tauri/src/documents.rs`：系统文件选择、限量读取与保存。

每次读取文件都由原生对话框选择，前端不能传入任意读取路径。文档内容只存在当前窗口内存，不自动持久化；主题偏好保存在本地。文件限制 5 MB，支持 UTF-8 文本及 PNG、JPEG、GIF、WebP。不会加载文档内的远程图片或执行 HTML。

欢迎提交针对桌面组件、可访问性、本地文档和跨平台兼容性的改进。不要提交个人文件、日志、凭据或私有服务实现。请为行为变化添加相应测试，并运行上述检查。
