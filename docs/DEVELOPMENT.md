# 开发桌面源码

公开源码可独立运行，使用 Tauri 2、React 19、TypeScript。默认是本地文档工作台，无需账号、模型密钥或私有仓库。侧栏“桌面组件与 CLI”打开从生产桌面提取的可交互控件及本机 CLI 发现页。

## 运行与检查

需要 Node.js 24、npm、Rust 1.95 和 [Tauri 系统构建依赖](https://v2.tauri.app/start/prerequisites/)。Windows 需要 MSVC/WebView2；macOS 需要 Xcode Command Line Tools。

```bash
git clone https://github.com/rfdiosuao/lom-desktop.git
cd lom-desktop
npm ci
npm run dev                 # 浏览器预览；不支持原生文件对话框/运行时
npm run tauri -- dev        # 原生桌面窗口
```

```bash
npm test
npm run build
npm run audit:public
python3 -m unittest discover -s tools -p 'test_*.py'
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
npm run tauri -- build      # macOS
# Windows: npm run tauri -- build --bundles nsis
```

Windows 用 `python` 代替 `python3`（按实际安装）。构建结果在 `src-tauri/target/release/bundle/`；这是公开工作台，不是官网完整版。CI 对 macOS / Windows 分别检查。

## 目录与接线

- `src/components`：原有文档按钮、图标、轻量 Markdown 与安全渲染测试。
- `src/desktop`：提取的桌面控件、圆形运行圈、列表/设置布局、双层上传菜单及预览。样式限定 `.desktop-kit`，不影响原工作台。
- `src/runtime`：桌面本机 CLI 连接与事件适配，不含云端、手机号、账户计费或跨设备协议。
- `src/core/documents.ts` / `src-tauri/src/documents.rs`：系统选择的限量文件读取/保存。
- `src-tauri/src/sidecar.rs` / `runtime.rs`：用户主动提供运行时后的启动、就绪与生命周期。
- `tools`：工作树/暂存区公开内容检查及隔离测试。

原生文件必须由系统对话框选择，前端不能传任意读取路径。上限 5 MB，支持 UTF-8 文本及 PNG/JPEG/GIF/WebP。当前文档只留内存，主题在本地；预览不自动加载远程图片或执行 HTML。

### 可选：本机 CLI 运行时

运行时和 CLI 均需自行安装；它们不属于本仓库的构建依赖。适配目标是支持本机回环 HTTP/事件协议的兼容运行时，要求支持启动端口、启动令牌和父进程退出检测。不要把远程服务地址或模型密钥填成运行时路径。

```bash
# macOS / Linux shell：用你自己安装的兼容运行时的绝对路径替换
LOM_CORE_BIN=/absolute/path/to/compatible-runtime npm run tauri -- dev
```

```powershell
# Windows PowerShell
$env:LOM_CORE_BIN = 'C:\Tools\CompatibleRuntime\runtime.exe'
npm run tauri -- dev
```

显式配置后，原生层启动该可执行文件；因此只指定你信任的程序。为公开工作台使用独立数据/工作目录，不直接复用官方产品用户数据。未配置、路径不存在、启动失败或超时会显示明确错误，本地文档仍可用。回环访问不依赖远程账号；CLI 自己的登录与权限仍沿用其原生规则。

“本机 CLI”页仅读取真实发现列表，不测试握手、不创建对话、不发送提示词。`cli.ts` 提供发现、创建、显式发送与取消适配；`events.ts` 接收实际运行事件并重连。它们目前**没有接成完整聊天界面**。社区可逐步补消息视图、权限/提问、状态恢复与工作区，不能把收到 turn ID 当成完成，也不能自动重试未知副作用。

令牌只留内存；不要打印连接对象、完整 WebSocket URL 或原始事件。组件不要直接访问网络，继续使用适配层。连接层限制回环地址和桌面会话路径；该限制不替代运行时自身的权限验证。

### UploadMenu 的回调契约

`loadSkills` 返回真实的 `{id,name,source,location}` 和目录警告；同名使用目录区分，空/错误不能用演示项替代。`scopeKey` 在数据所有者或工作区变化时更新，清空旧选择；读取回调保持稳定。

`prepareDraft(skill, choice)` 仅进入目标 Lom 并准备可编辑草稿，关联准确 ID/目录，不自动发送。调用方要再次核验当前作用域、目录和用户选择，不在异步完成后跨账号写入。`hasDraft` 由调用方计算；组件先询问追加/替换。`onManual` 保留已有手动入口。预览页没有这些业务适配器，会明确报未配置，不模拟上传成功。

## 参与开发

任务和未修问题集中在 [社区计划](../COMMUNITY_PLAN.md)，规则见 [贡献指南](../CONTRIBUTING.md)。不要提交生产日志、个人文件、私有服务实现或密钥。每个模块提取/行为变化都需检查独立构建、边界、许可证和真实支持范围。
