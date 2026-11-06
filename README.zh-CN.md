<div align="center">

# 麓鸣 Lom

**麓鸣 Lom 是桌面 AI 工作台：一个总指挥带多个电脑 Agent（Codex、Claude Code、Gemini CLI 等）和 Android 手机 Agent 协作。**

**Lom is a desktop AI workspace where one commander leads computer agents and Android phone agents as a single team.**

[官网](https://lom.entermodetwo.com/) · [English](README.md) · [使用文档](https://lom.entermodetwo.com/docs/) · [下载](https://lom.entermodetwo.com/#download) · [手机 Agent 接入文档](https://lom.entermodetwo.com/docs/phone-access/)

[![官网](https://img.shields.io/badge/官网-lom.entermodetwo.com-111112)](https://lom.entermodetwo.com/)
[![桌面端界面许可证：AGPL-3.0](https://img.shields.io/badge/桌面端界面-AGPL--3.0-blue)](LICENSE)
[![平台：macOS · Android](https://img.shields.io/badge/平台-macOS%20%C2%B7%20Android-lightgrey)](https://lom.entermodetwo.com/#download)
[![Stars](https://img.shields.io/github/stars/rfdiosuao/lom-desktop?style=flat)](https://github.com/rfdiosuao/lom-desktop/stargazers)

<img src="docs/images/lom-workspace.jpg" alt="麓鸣 Lom 桌面端工作台：选择参与本次任务的手机、工作区文件夹，并输入目标" width="760">

</div>

## 麓鸣能做什么

麓鸣装在你的电脑上，当总指挥。你说出目标，它把活拆开，派给合适的 Agent，读回真实结果再汇报给你。付款、下单、发布、私信这类对外操作，一定先问你。

- **电脑 Agent**：直接用你电脑上已安装的 Agent CLI，例如 Codex CLI、Claude Code、Gemini CLI、Kimi、Qwen、OpenCode。麓鸣自动检测本机已装的 Agent，每个 Agent 仍用它自己的模型和登录。
- **手机 Agent**：Android 手机扫码配对。官方手机端和第三方 Mika（麓鸣版）都可以接桌面派来的活；配对协议是公开的，你也可以做自己的手机端，见[手机 Agent 接入文档](docs/open/phone-access/README.md)。
- **个人助理**：有自己独立的对话与记忆，能定时办事，也能把活派给你的 OPC 团队。让 Jev 管理它的上下文即将推出。
- **OPC 团队群聊**：桌面 0.3.8 起，在一条时间线里 @队长，看活怎么派、怎么回报。手机成员在群聊里的呈现即将推出。
- **技能与 MCP**：技能市场、MCP、快捷命令，以及每个任务可选的四档权限。

<p align="center"><img src="docs/images/lom-agent-menu.jpg" alt="麓鸣 Agent 下拉菜单：列出这台电脑上检测到的 Agent CLI 及是否可用" width="640"></p>

> 以上描述的是麓鸣官方版。本仓库是社区源码，**不包含**商业账户、积分、模型网关和云配对中转，依赖这些服务的功能在社区构建里不可用（见下文）。

## 下载

macOS（Apple 芯片）和 Android 的官方安装包在官网：**<https://lom.entermodetwo.com/#download>**。Windows 版暂未上线。

## 快速开始

使用官方版：到官网下载安装，按[快速上手](https://lom.entermodetwo.com/docs/)操作。从本仓库源码构建桌面端界面：

```sh
cd apps/desktop
npm ci
npm run typecheck
npm test -- --maxWorkers=2
npm run build
```

本地 Rust 内核、Tauri 外壳和 Android 手机端各有自己的工具链，见 [BUILDING.md](BUILDING.md)。

## 关于本仓库

桌面端、运行内核、手机端和设备协议集中在同一仓库，供社区自行构建和继续开发。商业账户、积分订阅、模型网关、云配对中转、运营后台及部署模块不在发布范围。社区版桌面端和 Android 手机端可以在局域网内扫码配对，局域网消息使用签名加密的信封。

**默认不连接官方云。** 桌面普通任务请自行配置模型服务。依赖账户的 Personal Agent 功能仍需要兼容的服务；但桌面与手机的局域网配对在本地实现：桌面端开启一次性二维码会话，手机在同一私有网络里直接连接。手机端也保留了本地功能和协议源码，其上游的开发调试接口不能代替麓鸣的局域网配对。

局域网配对只适合受信任的私有网络：配对和控制的 HTTP 流量是明文，使用一次性二维码密钥和设备令牌；远程 RPC 载荷是签名加密的信封。不要把局域网端口暴露到公网或不受信任的网络。

### 目录与许可证

| 目录 | 内容 | 许可证 |
| --- | --- | --- |
| `apps/desktop` | React/TypeScript 界面与 Tauri 桌面外壳 | AGPL-3.0-only |
| `core` | 本地 Rust 运行内核，基于 AionCore | Apache-2.0，见组件声明 |
| `apps/android` | 基于 OpenMinis 的手机端源码，麓鸣的改动面向 Android | GPL-3.0，见第三方许可证 |
| `protocol` | 设备协议定义、生成的绑定和测试向量 | MIT OR Apache-2.0 |

这些是通过协议通信的独立程序，并不是对各组件许可证的重新授权。再分发时请保留各组件的声明。仓库里的 iOS 源码来自上游，不代表麓鸣支持 iPhone 配对。

来源版本见 [SOURCE_SNAPSHOTS.md](docs/SOURCE_SNAPSHOTS.md)，发布边界见 [OPEN_SOURCE_SCOPE.md](docs/OPEN_SOURCE_SCOPE.md)。私有 Git 历史和商业服务端源码没有导入；历史公开提交仍保留在本仓库的 Git 历史中。

发布修改前，请运行 `python3 tools/audit-source.py` 和相关组件的测试。审计只报告路径和规则名，不会打印匹配到的密钥内容；它只是审查的一层，不保证源码里没有任何敏感数据。

## 文档

- [官网文档](https://lom.entermodetwo.com/docs/)：快速上手、手机端配置、电脑端功能、OPC 团队、常见问题和更新日志。
- [手机 Agent 接入文档](docs/open/phone-access/README.md)（[官网版](https://lom.entermodetwo.com/docs/phone-access/)）：二维码与深链格式、配对、身份密钥、中转、加密信封、RPC 方法和测试向量，不接触任何私有代码就能做出可以和麓鸣桌面端配对的手机 App。
- [BUILDING.md](BUILDING.md)、[CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md)。

## 致谢

麓鸣建立在开源项目之上，感谢这些项目的作者与贡献者：

- [AionUi](https://github.com/iOfficeAI/AionUi)：桌面核心基于它构建。
- [OpenMinis](https://github.com/OpenMinis/OpenMinis)：手机端基于它构建。
- [Mika](https://github.com/wangzan101/Mika)（作者 wangzan101，Apache-2.0）：麓鸣版 Mika 所基于的第三方手机 Agent。麓鸣版不是原作者发布的版本，也不代表原作者。

## 许可证

许可证按组件分别适用，见上表和各组件的声明。桌面端界面与外壳为 AGPL-3.0-only，见 [LICENSE](LICENSE)。
